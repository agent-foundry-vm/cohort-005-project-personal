import { and, asc, desc, eq, notExists } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
  RefundStatus,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Refund Requests ───
// The vocabulary here follows GLOSSARY.md. A row in `refunds` is a Refund
// Request; once approved, its `amountRefunded` is the (Pending) Refund.

/**
 * Why a learner can't view a course they bought: their Refund Request is
 * still open, or it was approved and the money is on its way back.
 */
export type RefundHold = "open" | "approved";

/**
 * Decides the hold for one purchase from the statuses of its Refund Requests.
 * An approval is final, so it wins over anything else. A declined request
 * holds nothing — the learner gets the course back straight away.
 */
export function refundHoldFrom(statuses: RefundStatus[]): RefundHold | null {
  if (statuses.includes(RefundStatus.Approved)) return "approved";
  if (statuses.includes(RefundStatus.Open)) return "open";
  return null;
}

function getRefundStatusesForPurchase(purchaseId: number) {
  return db
    .select({ status: refunds.status })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .all()
    .map((row) => row.status);
}

/**
 * The learner's latest purchase of the course for themselves. A team-licence
 * purchase (one that issued seats) never gave the buyer the course, so it
 * never takes it away either.
 */
function getLatestPersonalPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          db
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.purchaseId, purchases.id))
        )
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

export function getRefundHold(
  userId: number,
  courseId: number
): RefundHold | null {
  const purchase = getLatestPersonalPurchase(userId, courseId);
  if (!purchase) return null;
  return refundHoldFrom(getRefundStatusesForPurchase(purchase.id));
}

/**
 * Is the purchase's money on its way back, or asked for? Seats on such a
 * purchase can't be claimed.
 */
export function getPurchaseRefundHold(purchaseId: number): RefundHold | null {
  return refundHoldFrom(getRefundStatusesForPurchase(purchaseId));
}

function isEnrolled(userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Enrolled, and not held back by a Refund Request. The enrollment row is
 * kept through a refund so the learner's progress survives a decline.
 */
export function hasCourseAccess(userId: number, courseId: number) {
  return isEnrolled(userId, courseId) && getRefundHold(userId, courseId) === null;
}

/** Course ids the learner is enrolled in but can't currently view. */
export function getHeldCourseIds(userId: number): Set<number> {
  const enrolledCourseIds = db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(eq(enrollments.userId, userId))
    .all()
    .map((row) => row.courseId);

  return new Set(
    enrolledCourseIds.filter(
      (courseId) => getRefundHold(userId, courseId) !== null
    )
  );
}

// ─── The Admin's queue ───

export function listOpenRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      purchasedAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      learnerName: users.name,
      learnerEmail: users.email,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Open))
    .orderBy(asc(refunds.requestedAt), asc(refunds.id))
    .all();
}

export type RefundDecision = "approve" | "decline";

export type DecideRefundRequestResult =
  | {
      ok: true;
      status: RefundStatus.Approved | RefundStatus.Declined;
      learnerName: string;
      learnerEmail: string;
      courseTitle: string;
      amountPaid: number;
    }
  | { ok: false; reason: "not-found" | "already-decided" };

/**
 * Records an Admin's decision. Decisions are final: only an Open Refund
 * Request can be decided, so a second Admin acting on the same request gets
 * "already-decided" rather than overwriting the first.
 */
export function decideRefundRequest(input: {
  refundRequestId: number;
  adminUserId: number;
  decision: RefundDecision;
}): DecideRefundRequestResult {
  return db.transaction((tx) => {
    const row = tx
      .select({
        status: refunds.status,
        amountPaid: purchases.amountPaid,
        learnerName: users.name,
        learnerEmail: users.email,
        courseTitle: courses.title,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(eq(refunds.id, input.refundRequestId))
      .get();

    if (!row) return { ok: false, reason: "not-found" } as const;

    const status =
      input.decision === "approve"
        ? RefundStatus.Approved
        : RefundStatus.Declined;

    const updated = tx
      .update(refunds)
      .set({
        status,
        // A Refund is always the full amount paid. A decline refunds nothing.
        amountRefunded: status === RefundStatus.Approved ? row.amountPaid : null,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: input.adminUserId,
      })
      .where(
        and(
          eq(refunds.id, input.refundRequestId),
          eq(refunds.status, RefundStatus.Open)
        )
      )
      .returning({ id: refunds.id })
      .get();

    if (!updated) return { ok: false, reason: "already-decided" } as const;

    return {
      ok: true,
      status,
      learnerName: row.learnerName,
      learnerEmail: row.learnerEmail,
      courseTitle: row.courseTitle,
      amountPaid: row.amountPaid,
    } as const;
  });
}

// ─── The learner's view ───

export function listRefundRequestsForLearner(userId: number) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      amountPaid: purchases.amountPaid,
      amountRefunded: refunds.amountRefunded,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .all();
}

/**
 * The status label a learner sees. Issuing the money isn't tracked yet, so
 * every Approved Refund Request has a Pending Refund.
 */
export function learnerRefundStatusLabel(
  status: RefundStatus,
  amountRefunded: number | null
): string {
  switch (status) {
    case RefundStatus.Open:
      return "Open";
    case RefundStatus.Declined:
      return "Declined";
    case RefundStatus.Approved:
      return `Approved — Pending Refund of ${formatPrice(amountRefunded ?? 0)}`;
  }
}

// ─── Emails ───
// There is no mail transport wired up yet, so built messages go to the log.

type Email = { to: string; subject: string; body: string };

export function buildRefundDecisionEmail(input: {
  status: RefundStatus.Approved | RefundStatus.Declined;
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amountPaid: number;
}): Email {
  const approved = input.status === RefundStatus.Approved;

  return {
    to: input.learnerEmail,
    subject: approved
      ? `Refund approved — ${input.courseTitle}`
      : `Refund request declined — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      approved
        ? `We have approved your refund request for "${input.courseTitle}". ${formatPrice(input.amountPaid)}, the full amount you paid, is on its way back to you.`
        : `We have declined your refund request for "${input.courseTitle}". Your access to the course is back, and you can pick up where you left off.`,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function logEmail(email: Email) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}
