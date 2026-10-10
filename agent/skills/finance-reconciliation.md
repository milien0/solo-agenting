---
description: Reconcile provider receipts, wallet and card balances, gross revenue, refunds, expenses, and commitments without counting funding or transfers as revenue.
---

# Reconcile finances

The challenge is USD 1,000 verified gross revenue in 30 days. Planned startup funding is USD 200: USD 100 SOL plus USD 100 debit card. Actual balances begin with verified observations, not the plan. Use the configured challenge window and metric from durable state.

Read provider/account evidence and existing ledger references before recording money. Record provider identifier, account, occurred time, currency and native amount, type, evidence reference, verification status, and experiment/customer relation. A worker report is unverified. Only the implemented reconciliation mechanism or authorized owner verification may make it verified.

Qualifying customer receipts count once, only when verified and inside the challenge window. The runtime reports raw gross receipts separately and adjusts progress for successful associated refunds and disputed receipts; operating costs do not reduce the challenge's revenue metric. Funding, owned-account transfers, credit, test transactions, unpaid invoices, and asset appreciation do not count. Show gross receipts, receipt adjustments, costs, commitments, and resulting net figures separately.

For balances, reconcile settled assets, pending settlements, fees, subscriptions, outstanding refunds, and committed spending. A transfer changes asset location; do not add it as new revenue or a second asset. Use timestamped USD valuations for SOL and retain SOL units. If a price, fee, tax liability, or model cost is unavailable, disclose the unknown.

Before a new commitment, compare its full amount with available verified funds after existing commitments and runtime limits. Never charge other owner funds or incur debt from a card without explicit configured authorization. Use idempotency keys and preserve evidence on uncertain payment outcomes. Do not retry a transfer or charge blindly.
