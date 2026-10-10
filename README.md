# Solo Agentic

Solo Agentic is a persistent agent application for an open-ended challenge: **earn USD 1,000 in eligible gross customer receipts within 30 days**, with **USD 200 planned startup capital: USD 100 SOL plus USD 100 on a debit card**. It researches opportunities, builds useful artifacts, coordinates workers, and records evidence without a predetermined commercial strategy. Returns and disputed receipts adjust progress; operating costs remain separate. The target is an experiment, not a promised return.

The official challenge starts **on the owner's Mac Mini after migration, account setup, and funding readiness**, followed by an explicit owner start. Work on the current Windows machine is preparation. The clock has not started and funding has not been inferred.

The public repository remains [milien0/solo-agenting](https://github.com/milien0/solo-agenting).

## Included

- **147 concrete capabilities**, with input schemas, effects, and explicit credential requirements. **67 are configuration-ready without provider credentials**; adding the current GitHub CLI access gives **85** before further RPC/provider configuration. Run `npm run doctor` for the live count; network services can still fail or require entitlement.
- **Five roles**: orchestrator, researcher, builder, operator, and finance; four declared eve specialists plus root-copy delegation.
- **10 agent skills** for research, experiments, delivery, coordination, reconciliation, and recovery.
- A SQLite task queue with bounded workers, leases, backoff, durable eve session recovery, shared memory, experiments, artifacts, and audit events.
- A local dashboard with polling updates, account readiness, queue state, receipts, and pause/resume controls.
- Windows background supervision, macOS launchd supervision for the Mac Mini, and a Docker deployment configuration.
- Automatic local setup and Solana wallet creation, with private material stored encrypted outside the project and only the public address returned.
- Separate owner and internal agent API credentials, explicit action gates, and idempotency checks that bind a key to the action's input.

## Run locally

On the Mac Mini, install Node.js **24.13 or newer** and Codex. Open the project/export in a terminal and run:

```sh
npm run setup
codex login status
npm run doctor
npm run background:start
```

Setup installs missing project dependencies, prepares private configuration, copies the selected Codex model without copying authentication files, detects existing CLI access, and provisions the local Solana wallet when no public address is already configured. It never starts the challenge. If this Mac has no Codex login, complete `codex login`. Provider sign-in, identity checks, actual wallet/card funding, and permissions for third-party accounts remain owner steps when they require the owner's identity or consent. See the [Mac Mini setup checklist](docs/setup.md).

Set `MODEL_PROVIDER=chatgpt` and an `EVE_MODEL` available to the signed-in account in your private `.env`. This installation uses **`gpt-6.1-sol`**, matching its Codex configuration; the signed-in account rejected `gpt-6-luna-fast`. A completed model turn establishes access to the chosen model. Login status or a healthy HTTP server alone does not prove model entitlement.

Open the [local dashboard](http://127.0.0.1:4310). The supervisor starts the headless eve engine on loopback port 2000 and dispatches preparation tasks. After migration, working model access, necessary account setup, and funding evidence are ready on the Mac Mini, press **Start challenge**. The clock stays in **setup** until that explicit action. Starting the application does not prove wallet/card funding or start earning revenue.

Configuration precedence is **inherited environment > `.env.local` > `.env`**. Keep real credentials out of Git. When an existing `.env` already contains your configuration, update it instead of replacing it with the example.

## Background operation

The same commands select the operating system's supervisor:

```powershell
npm run background:start
npm run background:stop
```

On macOS, start registers launchd agent **`com.soloagentic.runtime`** for the logged-in user; stop unloads it. On Windows, start launches a hidden process and registers **Solo Agentic Background**, a user-logon watchdog that checks the service every 30 seconds; stop disables that task and stops the identified application process tree. Durable state is retained. Windows supervision has been observed running on the development machine; Mac supervision must be verified after installation on the Mac Mini.

Local continuous operation requires the host to remain powered, awake, and connected. User-session supervision can recover eligible durable sessions after a process restart; it cannot operate while the host sleeps or is off. Hosted operation requires a separately running host and server credentials. This repository does not imply an always-on cloud deployment.

## Account setup

When no address is configured, `npm run setup` creates or reuses the vault's Solana wallet and writes its public address and the public mainnet RPC URL to private configuration. Private wallet material remains in the file vault at `~/.solo-agentic/vault`, outside the repository and agent workspace. The wallet record uses authenticated encryption; its encryption key is a separate file in the same owner-protected directory, so the complete vault must remain private. Setup exposes only the public address. An already configured public address is retained and does not prove the Mac has its private custody. The wallet still needs owner funding. Debit-card access, email, Stripe, and other accounts need actual delegated configuration before operations. Planned funding is not verified money, and no revenue is fabricated while accounts are missing.

| Access | Configuration and scope |
| --- | --- |
| Models | Local `MODEL_PROVIDER=chatgpt` with Codex-owned login, or hosted `MODEL_PROVIDER=gateway` with `AI_GATEWAY_API_KEY` |
| GitHub | Scoped `GITHUB_TOKEN`, or optional `GITHUB_AUTH_FROM_GH=true` to reuse an existing native GitHub CLI login; the runtime obtains its token in memory without printing or writing it |
| Search | `BRAVE_SEARCH_API_KEY` for Brave; public research utilities also exist |
| Solana | Setup fills `SOLANA_RPC_URL` and `SOLANA_WALLET_ADDRESS`; finalized reads only, with wallet signing/trading still absent |
| Stripe | `STRIPE_SECRET_KEY`; catalog writes also need `STRIPE_CATALOG_WRITE_ENABLED=true` |
| Gmail | Scoped `GMAIL_ACCESS_TOKEN`; drafts/sends have separate enable flags |
| X | `X_BEARER_TOKEN` for reads; user-context token and `X_POST_ENABLED=true` for posting |
| Vercel / Render | Existing account tokens for metadata and deployment-status reads |
| Remote MCP | Configured HTTPS endpoint and explicit `MCP_ALLOWED_TOOLS`; bounded approved read-only calls |

External publication and amount-bearing financial operations also require their configured `ENABLE_PUBLIC_ACTIONS` / `ENABLE_FINANCIAL_ACTIONS` gates. Set permissions only for the actual accounts and actions delegated to the application. A Codex plugin connection is separate from an independent server credential.

The current adapters do not sign Solana transactions, trade assets, make card purchases, perform payouts, automatically charge customers, or mutate refunds. Do not paste wallet seeds, card numbers, or secrets into prompts or public artifacts. See the [full tool library](docs/tool-library.md) for exact scopes, flags, schemas, and limits.

## Challenge accounting

Agent ledger reports remain **unverified**. Only provider reconciliation or the owner's authorized evidence path verifies receipts or funding. Startup funds, transfers, loans, test payments, unpaid invoices, token appreciation, and proposed business value do not count as earned revenue.

The dashboard reports raw gross receipts separately from refund/dispute adjustments. Eligible challenge revenue is verified customer receipts before operating costs, adjusted for those returns/disputes. Expenses, commitments, model costs where reported, and net figures remain separate. Stripe reconciliation uses live captured USD payments and successful individual refunds; other channels need an implemented adapter or owner evidence. A ledger balance is not a bank balance.

For paid Gateway sessions, `MAX_TOTAL_MODEL_COST_USD` defaults to **20**. Before dispatching another session, the supervisor reserves `MAX_SESSION_COST_USD` for active/new sessions and checks reported cost plus those reservations against the lower of the total model allowance and planned startup capital. This is a soft dispatch limit: provider-reported cost may arrive later, and a model call can overshoot its session limit. Subscription usage is unpriced when the provider supplies no cost; the dashboard shows an unknown cost rather than zero. The allowance does not prove available funding or establish a hard account-spending ceiling.

## Development and deployment

```powershell
npm run check
npm test
npx eve info --json
npm run tools
```

Tests cover capability boundaries, provider requests, bookkeeping, authorization, and durable task behavior. eve discovery checks the actual instructions, tools, skills, and subagents. These checks do not replace a real provider-entitlement check or live customer evidence.

- [Operating model and accounting](docs/operating-model.md)
- [Mac Mini setup and owner steps](docs/setup.md)
- [Capability catalog and account requirements](docs/tool-library.md)
- [Background operation and Docker deployment](docs/deployment.md)
- [Contributor instructions](AGENTS.md)

The application uses eve 0.76. Read its installed `node_modules/eve/docs/` before changing framework APIs or discovery paths. The dashboard and durable runtime are application code; `npm run agent` is eve's interactive development interface.

Dependency audit currently reports a moderate denial-of-service advisory in `sprintf-js`, brought in by the `just-bash` sandbox dependency. There is no compatible patched release offered by npm; its suggested downgrade would replace the current eve API. The sandbox is available only through the private local agent engine. Keep that engine private and review the advisory before expanding access to untrusted users.
