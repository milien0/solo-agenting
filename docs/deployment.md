# Running Solo Agentic continuously

Solo Agentic has two supervised processes: the application/dashboard on port 4310 and its headless eve engine on loopback port 2000. The application owns scheduling and the SQLite queue. The engine owns durable model/tool sessions. A running dashboard can still be waiting for model credentials or an unavailable model; verify both health and a completed useful task.

## Local configuration

Install Node.js 24.13 or newer and run `npm ci`. Copy `.env.example` to a private `.env` on a fresh checkout, then configure the model and required accounts. `.env.local` is also loaded and can override an inherited setting. Restart the service after changing runtime configuration.

For a local ChatGPT subscription, use:

```dotenv
MODEL_PROVIDER=chatgpt
EVE_MODEL=gpt-6.1-sol
HOST=127.0.0.1
PORT=4310
EVE_PORT=2000
MAX_WORKERS=3
TICK_SECONDS=900
```

This development machine has a Codex-owned login and uses `gpt-6.1-sol`, matching its actual Codex configuration. `gpt-6-luna-fast` was rejected by the signed-in account. Other accounts should select a model they can actually use. `codex login status` checks login; a completed inference checks the selected entitlement. Do not copy Codex's authentication files into this repository or a container.

Run `npm run doctor` to inspect configuration readiness without printing secrets. Run `npm start` for foreground operation and open [the dashboard](http://127.0.0.1:4310). Initial tasks prepare research, artifacts, and bookkeeping. The 30-day timer starts only through the owner's **Start challenge** control; no funding is implied by the configured USD 200 plan.

The default loopback dashboard establishes an owner browser session locally. `SOLO_API_TOKEN` is the owner credential for private API access. The supervisor supplies a separate internal token to the engine; that token can discover and execute capabilities but cannot impersonate the owner or verify arbitrary revenue. Keep owner/internal credentials distinct.

## Windows watchdog

```powershell
npm run background:start
```

The start script launches the application hidden, saves its process identity in `data/background.json`, and registers **Solo Agentic Background** for the current user. The scheduled task starts a watchdog at user logon; it checks every 30 seconds and starts the service when its expected process is absent. Startup registration has been confirmed on the current development machine. If registration fails on another machine, the script reports that limitation while leaving the process running.

The application also supervises the eve child process, restarting it with bounded backoff. Its startup command uses `--resume`, so eligible stored local sessions can recover. The queue persists accepted session identities before work; recovery inspects their stream rather than blindly replaying external effects. A missing or terminal session becomes an attention item.

To stop local background operation:

```powershell
npm run background:stop
```

This disables/stops the scheduled task, verifies the saved application's command line, and terminates its process tree. Data remains available. Starting again registers the watchdog again. Dashboard pause suspends dispatch and mutating capabilities and requests active-session cancellation; it is distinct from stopping the operating-system service.

Logs and state are private:

- `data/service.log` and `data/service-error.log`: background application output.
- `data/eve-engine.log`: model runtime startup and diagnostic output.
- `data/solo.sqlite`: tasks, memory, experiments, financial evidence, and events.
- `workspace/`: generated working artifacts.
- `.eve/`: eve compiled resources and durable local workflow/session data.

Keep the host powered, awake, network-connected, and logged in for local subscription operation. The watchdog cannot earn revenue while the computer is asleep or off. Windows recovery occurs at user logon; this setup is not a pre-login system service.

## Docker on an always-on host

The repository includes a Dockerfile and `compose.yaml` for one application service. The application launches its eve child inside that service. Compose uses `restart: unless-stopped` and binds the dashboard to host loopback. It does not create a cloud host or provision model/account credentials.

Use a private `.env` with a hosted model credential and a long randomly generated owner token:

```dotenv
MODEL_PROVIDER=gateway
EVE_MODEL=openai/gpt-6-luna-fast
AI_GATEWAY_API_KEY=your_server_gateway_key
SOLO_API_TOKEN=your_long_random_owner_token
MAX_SESSION_COST_USD=1
MAX_TOTAL_MODEL_COST_USD=20
ENABLE_PUBLIC_ACTIONS=false
ENABLE_FINANCIAL_ACTIONS=false
```

The shown values are placeholders, not credentials. Generate the owner token locally, store it privately, and supply an AI Gateway model available to that credential. Compose's explicit model settings select the Gateway path. Local ChatGPT subscription credentials are not deployed; configure a server API credential instead.

```sh
docker compose up -d --build
docker compose logs --tail=100
docker compose stop
```

Compose persists all three state directories in **named volumes**: `solo-data` at `/app/data`, `solo-workspace` at `/app/workspace`, and `solo-eve` at `/app/.eve`. These are Docker-managed volumes rather than checkout bind mounts, avoiding host-directory permission mismatches for the non-root `node` user. Actual volume names may include Compose's project prefix. SQLite persistence alone does not retain the eve sessions needed for accepted-task recovery.

Retain and back up all three volumes when replacing containers; verify ownership and restore behavior before relying on recovery. Removing volumes removes durable state. Avoid two application instances writing the same local workflow/queue files; this deployment is a single supervisor.

Health is available at `/healthz`. It reports application runtime state; an HTTP 200 is not model entitlement or proof of completed work. With Docker's network bridge, the application may see a non-loopback client, so dashboard/API access also requires owner authentication. Keep port 2000 private. Use a private authenticated reverse proxy or tunnel with the owner bearer credential, preserving the application's expected Host header and same-origin policy. This repository does not supply a public dashboard login or TLS proxy.

Before claiming the hosted worker is operational, confirm health, complete one real model task with evidence, inspect its durable task result, restart the process/container, and observe recovery without duplicate external actions. Docker infrastructure must actually be running on an always-on host. The current development setup has not been presented as a deployed cloud service.

## Accounts and operational limits

Wallet/card/email/Stripe access requires real delegated accounts and credentials. Account setup is described in the [README](../README.md#account-setup) and [tool catalog](tool-library.md). Solana adapters only read finalized account data. There is no wallet signing, direct trading, card purchasing, payouts, automatic customer charging, or refund mutation. Optional external action flags remain separate from account tokens.

Locally, `GITHUB_AUTH_FROM_GH=true` can reuse the operating user's existing native GitHub CLI login when `GITHUB_TOKEN` is absent. The runtime requests the stored credential through `gh`, keeps it in process memory, and does not print or copy it into a project file. The current `milien0` login enables 84 configuration-ready tools compared with the 66-tool baseline. A container has no automatic access to that host login; provision an appropriately scoped server token instead.

The worker limit and per-session token/cost limits bound work. `MAX_TOTAL_MODEL_COST_USD` defaults to USD 20 for paid Gateway dispatch. Before claiming another task for a paid session, the supervisor reserves `MAX_SESSION_COST_USD` for every active/new session and compares reported cost plus reserves with the lower of the configured total model allowance and planned startup capital. Once the allowance is insufficient, it leaves work queued and reports a model-budget limit. Cost records are summed across all stored sessions.

These are soft provider-reported limits: a model call can overshoot a session limit, usage can arrive after dispatch, and the total gate is not a hard cap at the provider account. Subscription usage has no USD estimate when the provider supplies no cost; it remains unknown and uses its provider quota, rather than being treated as free or covered by the paid Gateway calculation. The model allowance does not verify funding. Missing credentials, quota exhaustion, failed entitlement, network outages, customer dependencies, or unknown external outcomes are attention/blocker records. They must not be turned into invented progress.

The challenge reports eligible gross receipts before operating costs, with raw receipts and return/dispute adjustments separately. The timer, funding evidence, permissions, and accounting definition survive restarts. Preserve existing customer obligations when pausing or ending the challenge. See the [operating model](operating-model.md) for exact behavior and reconciliation limits.
