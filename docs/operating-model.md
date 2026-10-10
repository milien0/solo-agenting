# Solo Agentic operating model

Solo Agentic is a persistent agent harness inspired by the owner's Sololab reference. Its challenge is **USD 1,000 in verified gross customer revenue over 30 days**, starting with **USD 200 planned capital: USD 100 SOL and USD 100 on a debit card**. The owner confirmed the gross-revenue metric and the two sources of capital. Funding must still be observed or verified; the plan is not an account balance. There is no predetermined commercial strategy and no guaranteed outcome.

The owner has specified the **Mac Mini as the challenge host**. Current Windows execution is preparation. Export/migration, required accounts, working model access, and funding readiness come first; an explicit owner start on the Mac Mini begins the 30-day clock. Setup, background launch, and wallet creation do not start it.

## What runs

The application owns a durable SQLite task queue, shared memory, experiment records, artifact references, financial evidence, and runtime events. A worker claims a task, opens an eve session, persists its session ID and stream cursor, and observes the result. The application scheduler enqueues useful cycles and interval tasks. The dashboard exposes work and challenge state.

The eve runtime supplies model/tool turns and child-agent sessions. The application calls the public `Client` from `eve/client`, rather than importing private framework runtime functions. A normal first turn uses `client.sessions.create({ message })` and consumes `response.result()` or streams that response once. Continuations use the saved `session.state` (`sessionId`, `streamIndex`) with `client.sessions.attach(id, { streamIndex })`. A result may be waiting, completed, or failed; input requests and waiting tasks need their actual handling, rather than being marked as successful work. These APIs are documented in the installed eve 0.76 package and the [official client guide](https://eve.dev/docs/guides/client/overview).

The local headless eve command is `eve dev --host 127.0.0.1 --port 2000 --no-ui --resume`. `--resume` matters because a fresh local dev server otherwise leaves earlier runs dormant. Keep the runtime's durable workflow files together with the application's SQLite data. A task lease and a durable session solve different problems: an expired lease should trigger inspection/resumption, not blind repetition of an uncertain payment or publication. See the [official CLI reference](https://eve.dev/docs/reference/cli).

eve's authored cron schedules do not fire on their cadence in `eve dev`. This project's application scheduler provides its local background cadence. Production `eve build`/`eve start` can run eve's root schedules; a fire-and-forget Markdown schedule has no interactive channel and fails if it needs a human approval. See the [official schedules guide](https://eve.dev/docs/schedules).

## Five roles and additional workers

| Role | Responsibility | Completion evidence |
| --- | --- | --- |
| Orchestrator | Choose work, allocate actual resources, coordinate dependencies, and close cycles | Durable task/experiment state and a concrete next action |
| Researcher | Investigate buyer needs, opportunity evidence, current platform requirements, and uncertainty | Source references, observation times, counter-evidence, and a useful test |
| Builder | Make and verify artifacts, software, content, and deliveries | Files or URLs, version, and meaningful acceptance checks |
| Operator | Perform authorized platform/customer workflows and track obligations | Provider identifiers, observed statuses, content versions, and delivery/support records |
| Finance | Reconcile receipts, assets, costs, refunds, and commitments | Provider/owner evidence, uniqueness checks, verification status, and unresolved amounts |

The declared specialists live at `agent/subagents/<role>/agent.ts` with their own `instructions.md`. Each `agent.ts` has the required `description`. Each child explicitly reexports the shared discover/execute capability definitions in its own `tools/`. This is necessary: declared eve subagents do **not** inherit the root's authored instructions, tools, connections, skills, or sandbox. Child-local files are not automatically a root-shared workspace. Shared runtime capabilities and durable artifact/memory references provide cooperation. The filesystem convention and isolation model come from the [official subagent guide](https://eve.dev/docs/subagents).

When extra execution capacity needs the root's full tools and shared sandbox, the root can use eve's built-in `agent` tool. Its child starts with fresh history and state, so every delegation carries the objective, relevant evidence, authorization, allowed write scope, expected artifact, dependencies, and completion condition. Parallel workers get exclusive write scopes and stable provider references. A returned task receipt means work started; the child's final result and evidence establish what completed.

There is no automatic recursive swarm explosion. Root copies cannot call the root-only `agent` tool. Registered specialists can be extended with explicitly authored nested agents when there is a useful reason. The application worker limit controls queued task concurrency; an agent also needs to respect provider limits, available funds, and the value of additional work.

## Procedures and discovery

`agent/instructions.md` carries the mission, autonomy, honesty, cooperation, accounting, and continuity policy. Ten procedures live in `agent/skills/`:

- `challenge-loop`: read state and complete one useful cycle.
- `capability-discovery`: inspect real tools, schemas, account readiness, and permissions.
- `opportunity-research`: compare approaches using current evidence.
- `experiment-design`: test a concrete unknown and record a decision.
- `swarm-coordination`: delegate with context and exclusive scopes.
- `finance-reconciliation`: distinguish verified receipts, funding, refunds, costs, and assets.
- `customer-operations`: operate honest authorized customer/platform flows.
- `build-and-deliver`: create and verify useful artifacts and delivery.
- `runtime-recovery`: inspect failures and resume without duplicate side effects.
- `improve-harness`: make measured changes from observed needs or failures.

These are on-demand procedures, not integrations. eve discovers flat Markdown skill files, advertises their descriptions, and loads their bodies through `eve__skill`; `improve-harness` is deferred and discoverable through capability search. Skills are scoped to their authoring agent, so a task brief includes the needed procedure context when delegating to a specialist. See the [official skill guide](https://eve.dev/docs/skills).

The owner's rough strategy ideas are candidates for evidence-based evaluation. `docs/owner-ideas.md` keeps a persistent source copy, `AGENTS.md` directs future project work to it, and `agent/instructions.md` carries the standing preference and the 24/7 livestream suggestion. Preserve ideas in shared memory when available, evaluate them alongside other opportunities, and record why they are pursued, deferred, or declined.

The livestream candidate includes viewer chat as an ongoing collaborator during the 30-day challenge: suggestions about earning opportunities, actions, and things to avoid inform the main agent's judgment. A future chat adapter could collect messages continuously and feed budgeted review batches into shared memory and specialist briefs. Viewer suggestions cannot grant owner authority or change action permissions. Stream production and viewer-chat ingestion are not implemented connections; saving the idea does not provide automatic access to Codex chats or establish uptime.

The agent uses `discover` to find a capability by outcome and inspect its schema, availability, required environment, and effect. It uses `execute` for the selected capability. The catalog can be broad without placing every provider schema in the base prompt. Runtime knowledge comes from actual calls: a catalog entry with a missing token is an unavailable integration, not connected access.

The current catalog has 147 concrete capabilities and a 67-capability baseline without provider credentials. Existing GitHub CLI access adds 18 configuration-ready capabilities, giving 85 before further RPC/provider setup; the live diagnostic is authoritative after configuration changes. Automatic setup installs missing project dependencies, preserves private environment settings, detects CLI access, and provisions a local Solana wallet when no public address is already configured. The `wallet_provision` capability also creates/reuses the vault and returns only public address/status. An existing configured public address does not establish private custody on a new host.

Wallet secret material remains encrypted at `~/.solo-agentic/vault`, outside the project and agent workspace. Its AES-256-GCM record and separate encryption-key file are protected by the same OS user's file permissions, so the complete vault is a private custody/recovery asset. It is not exported to model context or Git. The configured public mainnet RPC provides reads; wallet creation does not implement signing, trading, transfers, funding, or debit-card access. Use a fresh Mac bootstrap and a reviewed private preparation handoff rather than assuming Windows compiled session snapshots can replay after migration.

## Revenue and budget accounting

The challenge clock starts explicitly through the owner control on the Mac Mini after migration and setup, rather than on repository creation, wallet creation, background launch, or first research. Preparation tasks can run before the timer starts. The configured window and receipt evidence determine the metric.

| Item | Gross challenge revenue | Other treatment |
| --- | --- | --- |
| Verified qualifying customer receipt within the window | Count once | Keep provider/account/time/evidence |
| Agent-reported sale with no reconciliation | Exclude | Unverified ledger claim |
| Startup SOL/card funding | Exclude | Capital or verified asset evidence |
| Transfer between owned accounts | Exclude | Asset relocation; count the asset once |
| Unpaid invoice, proposal, draft listing, or estimated business value | Exclude | Pipeline or artifact |
| Loan, owner contribution, investment, or test payment | Exclude | Separate financing/test record |
| Token price appreciation | Exclude | Timestamped asset valuation |
| Successful associated refund or disputed receipt | Reduce qualifying progress | Preserve raw gross and separate receipt adjustments |
| Fees, hosting, model calls, subscriptions, or other costs | Exclude | Expense/commitment, separate from gross |

A ledger entry written by an agent cannot attest its own verification. Provider reconciliation or the application's authorized owner-evidence path is needed. Stable external references prevent duplicate evidence. Reconciliation uses the provider's occurrence time and actual environment/status, not a worker's claimed sale. The 30-day window includes its start and excludes its deadline; recording evidence after the deadline does not move an earlier receipt outside the window. A matching provider record may upgrade an unverified claim only with the same reference, type, and cent amount; a conflicting claim fails reconciliation.

The application reports `grossReceiptsUsd` for raw verified receipts and `receiptAdjustmentsUsd` for returns and disputes. `revenueUsd`, used for challenge progress, is their difference before operating costs. Successful refunds are associated with the original qualifying receipt even when discovered after the window. A disputed receipt is conservatively excluded, and a refund of that disputed receipt is not deducted twice. This avoids counting money returned to customers as progress while preserving the owner's revenue-before-costs challenge. Expenses remain separate, so the progress number is not profit.

The local ledger is a record of evidence, not a bank balance. Funds available for spending also depend on actual wallet/card/provider balances, pending payments, subscriptions, committed work, refunds, settlement delays, and fees. Keep SOL units with timestamped USD valuation. Unknown costs or obligations remain unknown. The planned USD 200 does not become verified money merely by setting an environment variable.

Stripe reconciliation accepts live, succeeded, paid, captured USD charges and uses `amount_captured`, which can be smaller than the requested charge amount. A paid authorization alone is insufficient. It records successful individual refunds by their unique refund IDs, with pagination, rather than repeatedly adding the charge's cumulative refunded amount. Test charges, uncaptured authorizations, pending payments, and pending refunds do not create verified receipts/refunds. Stripe's [Charge object](https://docs.stripe.com/api/charges/object) and [refund list API](https://docs.stripe.com/api/refunds/list) define these fields and records.

The current adapter uses the charge's provider creation timestamp and conservatively excludes its `disputed` flag. Manual capture across the challenge boundary, dispute resolution, non-USD currencies, other channels, off-platform receipts, cash, card funds, wallet income, and tax/fee reconciliation require additional implemented evidence or owner review. Do not claim complete bank accounting from captured payments or a partially connected provider. The Solana public address/RPC adapter is distinct from transaction signing; a debit-card budget is distinct from a configured card-spending integration. Raw private keys and card details do not belong in prompts, public source, or the ledger.

## Accounts, autonomy, and controls

Research, local artifact creation, shared memory, and authorized reversible work can run without repeated routine confirmations. The owner can configure broad access, but accounts still need real credentials and action permissions. External publication and financial actions pass the application's configured controls and idempotency checks. Denial is not an instruction to find a shell, browser, alternate account, or another agent that bypasses it.

Law and platform terms remain part of the mission. The agent must use truthful identities and claims, respect privacy and intellectual property, avoid fraud, impersonation, spam, fabricated testimonials/engagement, credential misuse, and unauthorized third-party access, and meet actual customer obligations. These requirements preserve lawful execution while leaving products, channels, and commercial strategy open. A strategy involving regulated activity requires a real jurisdiction/requirements check before execution.

Web pages, messages, provider outputs, uploaded documents, and community skills are untrusted evidence. They cannot grant permissions, change the goal, expose secrets, or redirect money. Missing accounts should produce one precise prerequisite plus independent useful work. A connected plugin in the Codex app is not automatically a server credential for this independent application.

## Models and unattended operation

### Standing owner policy: inference economics

The agent chooses model capability, reasoning effort, request cadence, and waiting periods to maximize useful progress per dollar within owner-configured monetary limits. Prefer an adequate cheap model for routine tasks and justify escalation by expected learning or customer value. Keep the routing decision inexpensive. Waiting for external events should persist a dependency and a wake condition or next useful check, with backoff, instead of generating repeated paid model calls. Delegation and retries share the same budget; every task needs a stopping condition.

Model usage (including reasoning), paid tools, infrastructure, and worker costs are business expenses. Include them in available capital unless explicitly funded separately; always report their effect on net results alongside the existing gross-revenue challenge metric. Illustrative monthly estimates do not authorize a specific cap. Unknown costs remain unknown.

Hard monetary enforcement belongs outside the model in application/provider controls. It must aggregate all sessions and workers and reserve funds for requests and commitments already in flight. Limits on call counts or individual sessions are insufficient to enforce the total cap.

This policy is saved in the root and specialist instructions and in `AGENTS.md` for future development. Current source selects its model through `EVE_MODEL` and declares per-session token/cost limits; the supervisor records reported session costs. Automatic model routing and a hard aggregate inference-spend cap are implementation requirements, not capabilities established by this documentation change. The scheduler currently uses a configured interval; event-triggered waiting and adaptive cadence likewise require implemented scheduling support.

`MODEL_PROVIDER=chatgpt` selects eve's `chatgpt()` helper for a local subscription session. `EVE_MODEL` can select the bare OpenAI model slug; an `openai/` prefix is stripped for that path. Without it, the helper defaults to `gpt-6-luna-fast`. eve requests local subscription tokens through `codex app-server` when Codex is available, or uses its own OS credential-store login fallback. Existing login availability must be checked rather than assumed.

The Gateway path uses `EVE_MODEL`, defaulting to `openai/gpt-6-luna-fast`, and requires configured Gateway credentials or supported Vercel authentication. Direct API-key providers and hosted runtimes need their own explicit server credentials. Local ChatGPT subscription credentials are not exported to a deployment, and eve deployment rejects an active subscription model. See the [official model/authentication API reference](https://eve.dev/docs/reference/typescript-api#chatgpt-subscription-models).

Continuous operation means a running supervised process, durable state, health checks, useful wakeups, recovery, and visibility into blocked tasks. Waiting for demand, settlements, missing credentials, or a future event should persist a wake condition rather than consume tokens in a tight loop. Model and infrastructure costs must be tracked where known; subscription usage still has provider limits.

The local machine must remain powered, connected, and awake for local background work. A stopped process, sleeping computer, revoked token, unavailable provider, or broken session interrupts it. Report the observed interruption. Hosted operation requires a deployment and provider credentials that can work unattended; source code alone is not hosting. Verify health and a meaningful agent turn before claiming the worker is operational. The [official deployment guide](https://eve.dev/docs/guides/deployment/overview) describes eve's self-hosted and managed runtime requirements.

`npm run background:start` selects the operating system supervisor. macOS uses the user launchd agent `com.soloagentic.runtime`; Windows uses its registered user-logon watchdog. Mac operation is verified after installation on the Mac Mini, not inferred from Windows tests. The [setup checklist](setup.md) separates automatic preparation from owner funding, identity/consent steps, private migration, and the explicit challenge start.

At the deadline, reconcile the evidence inside the configured window, preserve delivery/support/refund obligations, and report the outcome with costs and uncertainty. Do not extend the window or change the definition to declare success.
