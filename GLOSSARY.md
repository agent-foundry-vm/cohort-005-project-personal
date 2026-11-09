# Course Platform

An online course platform where learners buy courses, watch lessons and track their progress.

## Language

### Refunds

**Refund**:
A learner's request to get back the money they paid for a Purchase. It is always in one of three states: Requested, Approved or Declined.
_Avoid_: Cancellation, Reversal, Chargeback

**Requested**:
A Refund the learner has raised that nobody has decided on yet.
_Avoid_: Pending, open

**Approved**:
A Refund that was accepted, so the money goes back to the learner.
_Avoid_: Refunded, completed

**Declined**:
A Refund that was turned down, so no money goes back.
_Avoid_: Rejected, not refunded

**Chargeback**:
A payment dispute the learner raises with their card issuer outside the platform. It is not a Refund, and the platform does not model it.
