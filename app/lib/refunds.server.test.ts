import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus } from "~/db/schema";

// Point the module's `db` at a fresh in-memory database for every test.
const holder = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import {
  buildRefundDecisionEmail,
  decideRefundRequest,
  getHeldCourseIds,
  getPurchaseRefundHold,
  getRefundHold,
  hasCourseAccess,
  learnerRefundStatusLabel,
  listOpenRefundRequests,
  listRefundRequestsForLearner,
  refundHoldFrom,
} from "./refunds.server";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  holder.db = testDb;
  base = seedBaseData(testDb);
  admin = testDb
    .insert(schema.users)
    .values({
      name: "Alex Rivera",
      email: "alex@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
});

function buyCourse(createdAt = new Date().toISOString(), amountPaid = 7900) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid,
      createdAt,
    })
    .returning()
    .get();
  const existing = testDb
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, base.user.id))
    .get();
  if (!existing) {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
  }
  return purchase;
}

function raiseRefundRequest(
  purchaseId: number,
  requestedAt = new Date().toISOString()
) {
  return testDb
    .insert(schema.refunds)
    .values({
      purchaseId,
      reason: "The course wasn't what I expected.",
      requestedAt,
    })
    .returning()
    .get();
}

function getRefundRow(id: number) {
  return testDb
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.id, id))
    .get();
}

describe("refundHoldFrom", () => {
  it("holds nothing when there are no Refund Requests", () => {
    expect(refundHoldFrom([])).toBeNull();
  });

  it("holds while a Refund Request is open", () => {
    expect(refundHoldFrom([RefundStatus.Open])).toBe("open");
  });

  it("holds nothing after a decline", () => {
    expect(refundHoldFrom([RefundStatus.Declined])).toBeNull();
  });

  it("lets an approval win over everything else", () => {
    expect(
      refundHoldFrom([RefundStatus.Declined, RefundStatus.Approved])
    ).toBe("approved");
  });
});

describe("decideRefundRequest", () => {
  it("approving sets the Refund to the full amount paid and records who decided", () => {
    const purchase = buyCourse(undefined, 7900);
    const refundRequest = raiseRefundRequest(purchase.id);

    const result = decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "approve",
    });

    expect(result).toMatchObject({ ok: true, status: RefundStatus.Approved });
    const row = getRefundRow(refundRequest.id);
    expect(row?.status).toBe(RefundStatus.Approved);
    expect(row?.amountRefunded).toBe(7900);
    expect(row?.resolvedByUserId).toBe(admin.id);
    expect(row?.resolvedAt).not.toBeNull();
  });

  it("declining refunds nothing", () => {
    const purchase = buyCourse();
    const refundRequest = raiseRefundRequest(purchase.id);

    decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "decline",
    });

    const row = getRefundRow(refundRequest.id);
    expect(row?.status).toBe(RefundStatus.Declined);
    expect(row?.amountRefunded).toBeNull();
    expect(row?.resolvedByUserId).toBe(admin.id);
  });

  it("treats a decision as final", () => {
    const purchase = buyCourse();
    const refundRequest = raiseRefundRequest(purchase.id);
    decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "decline",
    });

    const second = decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "approve",
    });

    expect(second).toEqual({ ok: false, reason: "already-decided" });
    expect(getRefundRow(refundRequest.id)?.status).toBe(RefundStatus.Declined);
  });

  it("reports a Refund Request that doesn't exist", () => {
    expect(
      decideRefundRequest({
        refundRequestId: 999,
        adminUserId: admin.id,
        decision: "approve",
      })
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("course access through a Refund Request", () => {
  it("is lost as soon as the request is raised", () => {
    const purchase = buyCourse();
    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(true);

    raiseRefundRequest(purchase.id);

    expect(getRefundHold(base.user.id, base.course.id)).toBe("open");
    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(false);
  });

  it("comes back straight away on a decline", () => {
    const purchase = buyCourse();
    const refundRequest = raiseRefundRequest(purchase.id);

    decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "decline",
    });

    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(true);
  });

  it("stays lost after an approval", () => {
    const purchase = buyCourse();
    const refundRequest = raiseRefundRequest(purchase.id);

    decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "approve",
    });

    expect(getRefundHold(base.user.id, base.course.id)).toBe("approved");
    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(false);
    expect(getHeldCourseIds(base.user.id)).toEqual(new Set([base.course.id]));
  });

  it("comes back when the learner buys the course again after an approval", () => {
    const first = buyCourse("2026-01-01T10:00:00.000Z");
    const refundRequest = raiseRefundRequest(first.id);
    decideRefundRequest({
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      decision: "approve",
    });

    buyCourse("2026-02-01T10:00:00.000Z");

    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(true);
  });

  it("isn't affected by a Refund Request on a team-licence purchase", () => {
    buyCourse("2026-01-01T10:00:00.000Z");
    const teamPurchase = buyCourse("2026-02-01T10:00:00.000Z", 15800);
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: teamPurchase.id,
      })
      .run();

    raiseRefundRequest(teamPurchase.id);

    expect(hasCourseAccess(base.user.id, base.course.id)).toBe(true);
    // ...but the seats on that purchase can't be claimed.
    expect(getPurchaseRefundHold(teamPurchase.id)).toBe("open");
  });
});

describe("listOpenRefundRequests", () => {
  it("lists only Open Refund Requests, oldest first", () => {
    const purchase = buyCourse();
    const decided = raiseRefundRequest(purchase.id, "2026-01-01T00:00:00.000Z");
    decideRefundRequest({
      refundRequestId: decided.id,
      adminUserId: admin.id,
      decision: "decline",
    });
    const newer = raiseRefundRequest(purchase.id, "2026-03-01T00:00:00.000Z");

    const other = testDb
      .insert(schema.users)
      .values({ name: "Liam", email: "liam@example.com", role: schema.UserRole.Student })
      .returning()
      .get();
    const otherPurchase = testDb
      .insert(schema.purchases)
      .values({ userId: other.id, courseId: base.course.id, amountPaid: 7900 })
      .returning()
      .get();
    const older = raiseRefundRequest(otherPurchase.id, "2026-02-01T00:00:00.000Z");

    const ids = listOpenRefundRequests().map((row) => row.id);
    expect(ids).toEqual([older.id, newer.id]);
  });
});

describe("what the learner sees", () => {
  it("lists every Refund Request with its status", () => {
    const purchase = buyCourse();
    const declined = raiseRefundRequest(purchase.id, "2026-01-01T00:00:00.000Z");
    decideRefundRequest({
      refundRequestId: declined.id,
      adminUserId: admin.id,
      decision: "decline",
    });
    raiseRefundRequest(purchase.id, "2026-02-01T00:00:00.000Z");

    const statuses = listRefundRequestsForLearner(base.user.id).map(
      (row) => row.status
    );
    expect(statuses).toEqual([RefundStatus.Open, RefundStatus.Declined]);
  });

  it("labels the three states", () => {
    expect(learnerRefundStatusLabel(RefundStatus.Open, null)).toBe("Open");
    expect(learnerRefundStatusLabel(RefundStatus.Declined, null)).toBe(
      "Declined"
    );
    expect(learnerRefundStatusLabel(RefundStatus.Approved, 7900)).toBe(
      "Approved — Pending Refund of $79.00"
    );
  });
});

describe("buildRefundDecisionEmail", () => {
  const input = {
    learnerName: "Liam",
    learnerEmail: "liam@example.com",
    courseTitle: "Introduction to TypeScript",
    amountPaid: 7900,
  };

  it("tells the learner their request was approved", () => {
    const email = buildRefundDecisionEmail({
      ...input,
      status: RefundStatus.Approved,
    });
    expect(email.to).toBe("liam@example.com");
    expect(email.subject).toContain("approved");
    expect(email.body).toContain("$79");
  });

  it("tells the learner their request was declined and access is back", () => {
    const email = buildRefundDecisionEmail({
      ...input,
      status: RefundStatus.Declined,
    });
    expect(email.subject).toContain("declined");
    expect(email.body).toContain("access to the course is back");
  });
});
