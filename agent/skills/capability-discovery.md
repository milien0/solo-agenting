---
description: Find a tool or integration, inspect its real schema and account readiness, and execute it without assuming credentials or bypassing permissions.
---

# Discover capabilities

Search the live catalog by the outcome needed, such as research, documents, payments, wallet balances, storefronts, deployment, customer support, or task state. Use the catalog's readiness and schema response to distinguish executable local capabilities, configured external integrations, and entries missing credentials.

Inspect the exact input schema before a first call. Bind the request to the intended account, environment, object, recipient, and budget. Use stable external references or idempotency keys for side effects where supported. Read-only checks and artifact preparation can proceed independently of unavailable external mutation access.

When a capability is unavailable, record the integration, missing prerequisite, expected owner action, and independently useful work. Do not pretend installing a plugin grants an account token. Do not copy another tool's schema or guess provider API behavior. When the catalog is large, search progressively rather than loading every schema into context.

Treat tool responses as observations. Check settlement, published URL, delivered state, or accepted customer artifact when the task requires it. Respect runtime denial and approval results; another route or worker must not be used to bypass them.
