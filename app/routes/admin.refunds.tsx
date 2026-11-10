import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { requireAdmin } from "~/lib/access.server";
import { parseFormData } from "~/lib/validation";
import {
  buildRefundDecisionEmail,
  decideRefundRequest,
  listOpenRefundRequests,
  logEmail,
} from "~/lib/refunds.server";
import { RefundStatus } from "~/db/schema";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, Check, ReceiptText, X } from "lucide-react";

const refundDecisionSchema = z.object({
  intent: z.enum(["approve", "decline"]),
  refundRequestId: z.coerce.number().int(),
});

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline open refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { refundRequests: listOpenRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const { userId } = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundDecisionSchema);

  if (!parsed.success) {
    throw data("Invalid decision.", { status: 400 });
  }

  const result = decideRefundRequest({
    refundRequestId: parsed.data.refundRequestId,
    adminUserId: userId,
    decision: parsed.data.intent,
  });

  if (!result.ok) {
    if (result.reason === "not-found") {
      throw data("Refund Request not found.", { status: 404 });
    }
    throw data("This Refund Request has already been decided.", {
      status: 409,
    });
  }

  logEmail(buildRefundDecisionEmail(result));

  return {
    decided: result.status,
    learnerName: result.learnerName,
  };
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">Refund Requests</h1>
      <p className="mb-8 text-muted-foreground">
        Open Refund Requests, oldest first. Decisions are final.
      </p>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ReceiptText className="mx-auto mb-4 size-10 text-muted-foreground" />
            <p className="font-medium">No Open Refund Requests</p>
            <p className="text-sm text-muted-foreground">
              New requests from learners will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: Route.ComponentProps["loaderData"]["refundRequests"][number];
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.decided) {
      toast.success(
        fetcher.data.decided === RefundStatus.Approved
          ? `Approved ${fetcher.data.learnerName}'s Refund Request.`
          : `Declined ${fetcher.data.learnerName}'s Refund Request.`
      );
    }
  }, [fetcher.state, fetcher.data]);

  function submitDecision(intent: "approve" | "decline") {
    const confirmation =
      intent === "approve"
        ? `Approve a ${formatPrice(refundRequest.amountPaid)} refund for ${refundRequest.learnerName}? This can't be undone.`
        : `Decline ${refundRequest.learnerName}'s Refund Request? This can't be undone, and they'll get the course back.`;

    if (!window.confirm(confirmation)) return;

    fetcher.submit(
      { intent, refundRequestId: String(refundRequest.id) },
      { method: "post" }
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{refundRequest.learnerName}</p>
            <p className="text-sm text-muted-foreground">
              {refundRequest.learnerEmail}
            </p>
          </div>
          <div className="text-right">
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-medium hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {formatPrice(refundRequest.amountPaid)} paid
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <div>
            <dt className="text-xs uppercase tracking-wide">Purchased</dt>
            <dd>{new Date(refundRequest.purchasedAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide">Requested</dt>
            <dd>{new Date(refundRequest.requestedAt).toLocaleDateString()}</dd>
          </div>
        </dl>
        <blockquote className="rounded-md border-l-4 bg-muted/50 p-3 text-sm">
          {refundRequest.reason}
        </blockquote>
        <div className="flex gap-2">
          <Button
            onClick={() => submitDecision("approve")}
            disabled={isSubmitting}
          >
            <Check className="mr-2 size-4" />
            Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => submitDecision("decline")}
            disabled={isSubmitting}
          >
            <X className="mr-2 size-4" />
            Decline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/admin/refunds">
          <Button>Back to Refund Requests</Button>
        </Link>
      </div>
    </div>
  );
}
