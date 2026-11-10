# Approving a Refund Request records a Pending Refund; it doesn't move money

There's no payment provider yet. So approving a Refund Request only sets `amountRefunded` to the full `amountPaid` on that row. The result is a Pending Refund. Recording the money as actually sent back (an Issued or Failed Refund) is left for a later, separate step. We kept the Admin's decision apart from sending the money. A failed payout then never reopens or reverses a decision that's final, and the approval screen could ship without waiting for a payments integration.

## Consequences

- Right now every Approved Refund Request has a Pending Refund. The learner's Settings page shows "Approved — Pending Refund of $X" until the money is tracked.
- The Refund Request is approved before any money goes back. Nobody should read "Approved" as "the learner has been paid".
