---
description: Recover stalled or failed durable tasks and integrations using health, session evidence, bounded retries, and preserved idempotency without inventing progress.
---

# Runtime recovery

Inspect process health, durable task status, session events, missing credential notices, last successful step, and provider references. Separate unavailable accounts, human input, transient network/provider failures, permanent validation errors, exhausted budget, and incomplete external outcomes.

Retry only when the failure is retryable, with bounded backoff and the original idempotency reference. Before retrying a payment, transfer, send, or publication, query the provider for its actual outcome. Quarantine permanent errors and record a concrete remedy. Do not use another route to bypass permission denials.

Resume the saved eve session ID and stream cursor when its session is active. A terminal or unknown ID requires an explicit fresh session; preserve the previous evidence and record the replacement. A resolved response with waiting status or an input request is not a finished job.

Store the precise blocker and wake condition. Continue independent work while blocked. Verify recovery using health plus a meaningful task result. Report downtime, unknown external outcomes, and unavailable credentials honestly. A scheduler being enabled does not prove that work ran.
