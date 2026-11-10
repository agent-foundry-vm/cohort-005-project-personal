# A Refund Request holds course access; the enrollment is never deleted

A learner loses access to a course the moment they raise a Refund Request, not when an Admin approves it. Otherwise they could ask for their money back and keep watching while they wait. A decline gives access back straight away. We considered deleting the enrollment when the request is raised and creating it again on a decline. We chose to keep the enrollment row and work out access from the Refund Requests on the learner's latest personal purchase (`hasCourseAccess` in `app/lib/refunds.server.ts`). That way lesson progress survives a decline, or a repurchase after an approval, and a decline needs no extra writes.

## Consequences

- "Has an enrollment" no longer means "can view the course". Every access check must go through `hasCourseAccess` or `getAccess`, never a raw `enrollments` lookup. The course, module, welcome, purchase, dashboard and course-list pages already do this.
- An Approved Refund Request holds access for good, until the learner buys the course again. The newer purchase then becomes the one the hold is worked out from.
- The request form and confirmation email warn the learner that they lose access while the request is open.
