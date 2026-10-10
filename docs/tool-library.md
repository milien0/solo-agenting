# Solo Agentic tool library

The library contains **146 named capabilities**. Each has a validated Zod input schema, a declared effect, explicit credential requirements, and a working implementation. With no provider credentials, **66 tools are configuration-ready**: local files/data/time/math, durable runtime operations, URL utilities, and public research APIs. External network/API availability and provider entitlements are checked when a tool executes; a configured token is not a guarantee of healthy service access.

The challenge measures **$1,000 gross revenue in 30 days**, starting from proposed **$200 capital** ($100 Solana plus $100 debit card). Funding is not revenue. The tool library does not assume either account has been funded, create financial accounts, or claim that the challenge goal can be guaranteed.

## Execution and configuration

Every `execute` call validates input and rejects missing configuration before an API request. The host must invoke capabilities through its policy/audit layer; the library itself does not authorize effects. `read` inspects information, `write` changes internal/local records, `public` publishes or communicates externally, and `financial` creates financial evidence or amount-bearing sales records. Financial metadata does not mean that a tool spends capital: the current financial adapters include ledger evidence, catalog prices and hosted sales links. There are no wallet signing, trading, payouts, card purchases, automatic charges or refund mutations.

| Provider | Required configuration | Scope and readiness |
| --- | --- | --- |
| GitHub | `GITHUB_TOKEN` | Fine-grained token scoped to intended repositories; read, issues, contents and PR permissions depend on the tool. |
| Brave | `BRAVE_SEARCH_API_KEY` | Existing Search subscription; metering and provider limits apply. |
| Stripe | `STRIPE_SECRET_KEY` | Existing account; prefer restricted/test keys while setting up. Reads are enabled by credentials. Catalog/customer/draft/sales writes additionally require `STRIPE_CATALOG_WRITE_ENABLED=true`. |
| Solana | `SOLANA_RPC_URL` | Public HTTPS RPC URL, optionally provider credentials in its configured endpoint. Wallet public address is an explicit tool input. No private key is requested or stored. |
| Gmail | `GMAIL_ACCESS_TOKEN` | Existing OAuth token with appropriate mailbox scopes. Draft creation additionally requires `GMAIL_DRAFT_ENABLED=true`; sending additionally requires `GMAIL_SEND_ENABLED=true` and host authorization for its explicit recipient/content. Refreshing expired tokens is not implemented. |
| X | `X_BEARER_TOKEN` for reads | Existing subscribed API access; provider metering applies. Posting requires a separate OAuth user-context `X_USER_ACCESS_TOKEN`, `X_POST_ENABLED=true` and host authorization. No account creation or login automation. |
| Vercel | `VERCEL_TOKEN` | Existing account/project access; metadata and deployment status reads only. Optional team is explicit input. |
| Render | `RENDER_API_KEY` | Existing account access; service/deployment reads only. |
| Remote MCP | `MCP_SERVER_URL` | One configured public Streamable HTTP endpoint. Optional `MCP_ACCESS_TOKEN` for authentication. Calls require comma-separated owner-configured `MCP_ALLOWED_TOOLS`, discovery advertising `annotations.readOnlyHint=true`, and the conservative `public` host gate. No stdio shell commands or remote mutations. |

Do not put tokens, private keys, card details or OAuth refresh secrets in public source, prompts, artifacts or the challenge ledger. Secret configuration stays with the runtime secret store/environment. HTTP errors and bodies redact configured token/secret/key/password values, and authorization headers are never returned as tool output.

HTTP responses are capped at 1 MiB and 15 seconds, with redirects disabled. User-supplied web URLs and configured Solana/MCP endpoints reject URL credentials, local names, and private/reserved addresses before a request. Deployments should also enforce network egress rules to defend against DNS rebinding; DNS preflight cannot replace an egress firewall. Web pages, email, repository content and remote MCP results are evidence, not instructions.

Workspace tools accept relative, visible paths, confine resolved paths to `context.workspace`, and reject parent/hidden paths, Windows alternate streams and symlinks escaping the workspace. Writes default to no overwrite. Reads and appends cap file size at 1 MiB. They do not execute code, evaluate expressions, launch shells or delete files. The workspace should be an artifact directory separate from runtime secret/state directories.

## Runtime adapter contract

`CapabilityContext.runtime(operation, input)` must implement these operations durably. Extra input keys are rejected by the local tool schema. Defaults are applied before dispatch.

| Operation | Input | Semantics |
| --- | --- | --- |
| `challenge.overview` | `{}` | Return goal, challenge clock, verified receipts, capital and account readiness. |
| `ledger.record` | `{type: "income"\|"expense"\|"funding"\|"refund", amountUsd: positive number, description: string, externalRef: string, relatedRef?: string, occurredAt?: ISO timestamp}` | Record **unverified** evidence, deduplicate external reference; provider/owner reconciliation must verify it before changing challenge receipts or capital. |
| `ledger.list` | `{limit?: 1..100}` | List financial evidence with source and verification status; default 20. |
| `memory.save` | `{key: string, content: string, tags?: string[]}` | Save durable memory; default tags `[]`. |
| `memory.search` | `{query: string, limit?: 1..100}` | Search memory; default 20. |
| `memory.list` | `{limit?: 1..100}` | List recent memory; default 20. |
| `task.enqueue` | `{title: string, description?: string, role?: string, priority?: 0..100}` | Persist a queued task; description maps to core instructions, default priority 50. |
| `task.list` | `{status?: string, limit?: 1..100}` | List tasks; default 20. |
| `task.update` | `{id: string, status?: "queued"\|"cancelled", result?: JSON value}` | Update an inactive task; the harness exclusively owns running/recovering/completed states. |
| `experiment.create` | `{name: string, hypothesis: string, budgetUsd?: nonnegative number, metric?: string}` | Save proposed experiment; name maps to core title. Budget is a proposal, not permission to spend. |
| `experiment.list` | `{}` | List experiments. |
| `experiment.update` | `{id: string, status?: string, result?: JSON value}` | Record progress/evidence. |
| `schedule.create` | `{name: string, intervalSeconds: 60..2592000, task: {title: string, description?: string, role?: string}}` | Persist an interval schedule that enqueues work; no cron parser or infinite model loop. |
| `schedule.list` | `{}` | List schedules. |
| `schedule.remove` | `{id: string}` | Remove one identified schedule. |
| `artifact.record` | `{name: string, path: string, url?: URL, type?: string}` | Record artifact metadata; does not upload or publish the artifact. |
| `artifact.list` | `{}` | List recorded artifacts. |
| `swarm.status` | `{}` | Return worker/queue status. |
| `swarm.delegate` | `{title: string, description: string, role?: string}` | Enqueue concrete work for a swarm role. |
| `checkpoint.save` | `{name: string, data: JSON value}` | Save progress durably before yielding. |
| `checkpoint.list` | `{}` | Read checkpoints. |
| `events.list` | `{limit?: 1..100}` | Read audited events; default 20. |

Stripe reconciliation should retrieve actual paid charge/payment objects and refunds, verify configured account ownership and currency, and deduplicate provider IDs. A `ledger_record` statement or a Stripe event name alone is not payment evidence. Funding and operating expenses remain separate from gross sales receipts.

## Adapter details and limits

Stripe create operations use mandatory idempotency keys. Prices use explicit integer minor currency units. Hosted links retrieve the price first and reject currency/amount mismatches, inactive prices and recurring prices. Invoice creation produces an empty manual-collection draft with `auto_advance=false`; it cannot collect or send payment. Returned links become public only when separately distributed through an authorized publishing operation.

Gmail composes plain-text MIME messages with UTF-8 encoded subjects/body, prohibits recipient/subject header injection, and sends to one explicit recipient. It does not spoof a sender, perform bulk messaging or mutate mailbox settings. Provider OAuth scope and account access still govern each operation.

Solana RPC requests are finalized read queries. `solana_balance` reports lamports and SOL, with no USD price assumption. Token account reads default to the original SPL Token program; pass the Token-2022 program explicitly when relevant. RPC methods that fetch a large block or account response may hit the 1 MiB cap. There is no key custody or transaction submission.

Remote MCP implements a bounded Streamable HTTP initialize/initialized handshake, session headers, matching JSON-RPC response IDs, JSON or finite SSE responses, and supported negotiated versions `2025-03-26`, `2025-06-18` and `2025-11-25`. Legacy standalone SSE, long-lived streams, arbitrary stdio commands, OAuth consent/login, unsolicited server requests and remote mutating tools are outside this adapter. Read-only hints are declarations by the configured server; only connect a server the owner trusts.

All provider lists return one bounded page unless explicitly paginating MCP discovery for a named allowed tool. They do not silently crawl an entire account. Arithmetic utilities evaluate fixed operations, never code. CSV parsing supports escaped quotes and embedded newlines but is not an Excel formula sanitizer; treat downloaded spreadsheet cells as untrusted.

## Primary API references

- [GitHub REST API usage and version headers](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api)
- [Stripe Payment Links API](https://docs.stripe.com/api/payment-link), [Stripe API reference](https://docs.stripe.com/api)
- [Solana HTTP RPC method reference](https://solana.com/docs/rpc/http), [token accounts by owner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)
- [Gmail REST reference](https://developers.google.com/workspace/gmail/api/reference/rest), [Gmail MIME sending guide](https://developers.google.com/workspace/gmail/api/guides/sending)
- [X create posts and OAuth scopes](https://docs.x.com/x-api/posts/create-post)
- [Brave Search API authentication and query parameters](https://api-dashboard.search.brave.com/app/documentation/web-search)
- [Vercel deployment listing](https://vercel.com/docs/rest-api/deployments/list-deployments)
- [Render services API](https://api-docs.render.com/reference/list-services)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MediaWiki search](https://www.mediawiki.org/wiki/API:Search) and [text extracts](https://www.mediawiki.org/wiki/Extension:TextExtracts), [Crossref public metadata API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), [Open-Meteo forecast documentation](https://open-meteo.com/en/docs)

## Capability catalog

<!-- Generated from createCapabilities; schema discovery is available through the runtime tool list. -->

| Tool | Category | Effect | Required configuration | Purpose |
| --- | --- | --- | --- | --- |
| workspace_list | workspace | read | None | List visible files in a workspace directory. |
| workspace_read | workspace | read | None | Read a visible UTF-8 file up to 1 MiB. |
| workspace_stat | workspace | read | None | Inspect size and modification time of a visible path. |
| workspace_write | workspace | write | None | Write UTF-8 content; existing files require overwrite=true. |
| workspace_append | workspace | write | None | Append UTF-8 content to a visible file up to 1 MiB total. |
| workspace_mkdir | workspace | write | None | Create a visible workspace directory. |
| workspace_copy | workspace | write | None | Copy a visible regular file; never overwrite an existing target. |
| workspace_search | workspace | read | None | Find literal text in one visible UTF-8 file. |
| workspace_hash | workspace | read | None | Compute SHA-256 for a visible UTF-8 file. |
| workspace_json_read | workspace | read | None | Parse a visible JSON file. |
| workspace_csv_read | workspace | read | None | Read and parse a visible CSV file. |
| text_stats | text | read | None | Count characters, words, lines and estimated reading seconds. |
| text_slug | text | read | None | Convert text to a lowercase URL slug. |
| text_replace | text | read | None | Replace a literal string without evaluating expressions. |
| text_split | text | read | None | Split text into lines, words or fixed-size chunks. |
| text_template | text | read | None | Fill {{name}} placeholders from explicit string values. |
| text_diff | text | read | None | Compare two texts and return changed lines by index. |
| json_parse | data | read | None | Parse and validate JSON syntax. |
| json_format | data | read | None | Format a JSON value with indentation. |
| csv_parse | data | read | None | Parse quoted CSV including escaped quotes and embedded newlines. |
| csv_stringify | data | read | None | Serialize string rows as quoted CSV. |
| data_unique | data | read | None | Remove duplicates from scalar values. |
| data_sort | data | read | None | Sort finite numeric values ascending or descending. |
| calculate | math | read | None | Apply arithmetic to finite numeric operands; no code evaluation. |
| statistics | math | read | None | Compute mean, median, sum and population standard deviation. |
| percentage | math | read | None | Compute a part as a percentage of a nonzero total. |
| unit_economics | math | read | None | Calculate contribution margin and break-even sales from explicit costs. |
| goal_forecast | math | read | None | Project required daily revenue using current verified revenue and days remaining. |
| time_now | time | read | None | Return current UTC time and epoch milliseconds. |
| time_convert | time | read | None | Format an ISO timestamp in a specified IANA timezone. |
| time_add | time | read | None | Add seconds to an ISO timestamp. |
| time_difference | time | read | None | Calculate elapsed seconds between two ISO timestamps. |
| generate_uuid | data | read | None | Create a random UUID for idempotency and record identifiers. |
| hash_text | data | read | None | Compute SHA-256 of text. |
| base64_encode | data | read | None | Encode UTF-8 text as base64. |
| base64_decode | data | read | None | Decode base64 text as UTF-8. |
| challenge_overview | runtime | read | None | Read challenge goal, deadline, verified revenue and capital. |
| ledger_record | runtime | financial | None | Record unverified financial evidence with an optional occurrence time or linked receipt; provider or owner reconciliation must verify it before it counts. |
| ledger_list | runtime | read | None | Read financial ledger entries and verification status. |
| memory_save | runtime | write | None | Save durable research or operational memory. |
| memory_search | runtime | read | None | Search durable memory by text query. |
| memory_list | runtime | read | None | List recent durable memories. |
| task_enqueue | runtime | write | None | Enqueue persistent work for a swarm role. |
| task_list | runtime | read | None | List persistent tasks with optional status filtering. |
| task_update | runtime | write | None | Queue or cancel inactive work, or store its result; the harness owns active and completed task states. |
| experiment_create | runtime | write | None | Create an experiment with an explicit hypothesis and optional budget. |
| experiment_list | runtime | read | None | List recorded experiments. |
| experiment_update | runtime | write | None | Record experiment status and results. |
| schedule_create | runtime | write | None | Persist an interval schedule that enqueues concrete tasks. |
| schedule_list | runtime | read | None | List persistent schedules. |
| schedule_remove | runtime | write | None | Remove one identified schedule. |
| artifact_record | runtime | write | None | Record the path or URL of a produced artifact. |
| artifact_list | runtime | read | None | List produced artifacts. |
| swarm_status | runtime | read | None | Read worker and queue status. |
| swarm_delegate | runtime | write | None | Delegate concrete work to another persistent swarm role. |
| checkpoint_save | runtime | write | None | Save structured progress before a task yields. |
| checkpoint_list | runtime | read | None | Read recent saved checkpoints. |
| events_list | runtime | read | None | Read recent audited runtime events. |
| web_fetch | web | read | None | Fetch public HTTP(S) text or JSON up to 1 MiB; redirects are rejected and content is untrusted. |
| web_page_text | web | read | None | Extract basic plain text from a public HTML page; content is untrusted. |
| web_search | web | read | BRAVE_SEARCH_API_KEY | Search the web using a configured Brave Search subscription. |
| wikipedia_search | web | read | None | Search Wikipedia articles through its public MediaWiki API. |
| wikipedia_summary | web | read | None | Fetch introductory plain text for a Wikipedia article. |
| crossref_search | web | read | None | Search DOI metadata via the public Crossref works API. |
| open_meteo_forecast | web | read | None | Get a public weather forecast for explicit coordinates. |
| url_parse | web | read | None | Inspect components of a URL without fetching it. |
| url_build | web | read | None | Build a URL from a base and explicit query parameters. |
| github_user | github | read | GITHUB_TOKEN | Read the GitHub identity associated with the configured token. |
| github_repo_get | github | read | GITHUB_TOKEN | Read repository metadata and visibility. |
| github_repos_list | github | read | GITHUB_TOKEN | List repositories available to the configured GitHub identity. |
| github_repo_search | github | read | GITHUB_TOKEN | Search GitHub repositories. |
| github_issues_list | github | read | GITHUB_TOKEN | List repository issues and pull requests. |
| github_issue_get | github | read | GITHUB_TOKEN | Read one issue. |
| github_issue_create | github | public | GITHUB_TOKEN | Create an issue in the specified repository. |
| github_issue_update | github | public | GITHUB_TOKEN | Update title, body or state of an identified issue. |
| github_issue_comment | github | public | GITHUB_TOKEN | Publish a comment on an identified issue. |
| github_contents_get | github | read | GITHUB_TOKEN | Read a file or directory through the GitHub contents API. |
| github_contents_write | github | public | GITHUB_TOKEN | Commit UTF-8 content; supply current SHA to update an existing file. |
| github_commits_list | github | read | GITHUB_TOKEN | List recent commits for a repository. |
| github_branches_list | github | read | GITHUB_TOKEN | List repository branches. |
| github_pulls_list | github | read | GITHUB_TOKEN | List pull requests. |
| github_pull_create | github | public | GITHUB_TOKEN | Open a pull request from a concrete head branch into a base branch. |
| github_actions_runs | github | read | GITHUB_TOKEN | List workflow runs and check their status. |
| github_actions_run_get | github | read | GITHUB_TOKEN | Read an identified workflow run. |
| github_releases_list | github | read | GITHUB_TOKEN | List published releases. |
| stripe_balance | stripe | read | STRIPE_SECRET_KEY | Read Stripe available and pending balances. |
| stripe_balance_transactions | stripe | read | STRIPE_SECRET_KEY | List balance transactions for revenue and fee reconciliation. |
| stripe_account | stripe | read | STRIPE_SECRET_KEY | Read the configured Stripe account and payment capability status. |
| stripe_products_list | stripe | read | STRIPE_SECRET_KEY | List Stripe product catalog entries. |
| stripe_product_get | stripe | read | STRIPE_SECRET_KEY | Read one Stripe product. |
| stripe_product_create | stripe | write | STRIPE_SECRET_KEY, STRIPE_CATALOG_WRITE_ENABLED | Create a product catalog entry; does not collect or move money. |
| stripe_prices_list | stripe | read | STRIPE_SECRET_KEY | List Stripe prices, optionally for one product. |
| stripe_price_get | stripe | read | STRIPE_SECRET_KEY | Read one Stripe price and currency. |
| stripe_price_create | stripe | financial | STRIPE_SECRET_KEY, STRIPE_CATALOG_WRITE_ENABLED | Create a one-time catalog price with a concrete amount in minor currency units. |
| stripe_payment_links_list | stripe | read | STRIPE_SECRET_KEY | List hosted payment links. |
| stripe_payment_link_get | stripe | read | STRIPE_SECRET_KEY | Read one hosted payment link. |
| stripe_payment_link_create | stripe | financial | STRIPE_SECRET_KEY, STRIPE_CATALOG_WRITE_ENABLED | Create a hosted sales link after verifying a one-time price matches the explicit expected amount and currency. |
| stripe_customers_list | stripe | read | STRIPE_SECRET_KEY | List Stripe customers, optionally matching an email. |
| stripe_customer_get | stripe | read | STRIPE_SECRET_KEY | Read one Stripe customer. |
| stripe_customer_create | stripe | write | STRIPE_SECRET_KEY, STRIPE_CATALOG_WRITE_ENABLED | Create a Stripe customer record without attaching payment methods or charging. |
| stripe_invoices_list | stripe | read | STRIPE_SECRET_KEY | List invoices for payment reconciliation. |
| stripe_invoice_get | stripe | read | STRIPE_SECRET_KEY | Read one invoice and its paid status. |
| stripe_invoice_draft_create | stripe | write | STRIPE_SECRET_KEY, STRIPE_CATALOG_WRITE_ENABLED | Create an empty manual-collection draft invoice with auto-advance disabled; never charge or send it. |
| stripe_charges_list | stripe | read | STRIPE_SECRET_KEY | Read charges including paid/refunded status for verified revenue reconciliation. |
| stripe_charge_get | stripe | read | STRIPE_SECRET_KEY | Read one charge with actual payment and refund evidence. |
| stripe_events_list | stripe | read | STRIPE_SECRET_KEY | Read recent Stripe events; verify payment objects before crediting revenue. |
| stripe_payment_intents_list | stripe | read | STRIPE_SECRET_KEY | Read payment intents and their settlement status. |
| solana_balance | solana | read | SOLANA_RPC_URL | Read a public wallet balance in lamports and SOL. |
| solana_account_info | solana | read | SOLANA_RPC_URL | Read public account state using parsed encoding. |
| solana_signatures | solana | read | SOLANA_RPC_URL | Read recent finalized transaction signatures for an address. |
| solana_transaction | solana | read | SOLANA_RPC_URL | Read a finalized transaction; does not sign or submit. |
| solana_signature_status | solana | read | SOLANA_RPC_URL | Read confirmation and error status for transaction signatures. |
| solana_token_accounts | solana | read | SOLANA_RPC_URL | Read SPL token accounts owned by a public wallet. |
| solana_token_balance | solana | read | SOLANA_RPC_URL | Read the public token balance of an SPL token account. |
| solana_token_supply | solana | read | SOLANA_RPC_URL | Read total token supply for a public mint. |
| solana_slot | solana | read | SOLANA_RPC_URL | Read the current finalized slot. |
| solana_block | solana | read | SOLANA_RPC_URL | Read block metadata and signatures for a finalized slot. |
| solana_latest_blockhash | solana | read | SOLANA_RPC_URL | Read a current finalized blockhash and expiry height. |
| solana_fee_estimate | solana | read | SOLANA_RPC_URL | Read the estimated network fee for a supplied base64 transaction message; never sign or submit. |
| solana_rent_estimate | solana | read | SOLANA_RPC_URL | Read minimum lamports required for a rent-exempt account size. |
| solana_health | solana | read | SOLANA_RPC_URL | Read RPC node health. |
| solana_version | solana | read | SOLANA_RPC_URL | Read RPC software and feature-set versions. |
| gmail_profile | gmail | read | GMAIL_ACCESS_TOKEN | Read the mailbox profile for the configured OAuth token. |
| gmail_messages_list | gmail | read | GMAIL_ACCESS_TOKEN | Search Gmail message IDs using Gmail query syntax. |
| gmail_message_get | gmail | read | GMAIL_ACCESS_TOKEN | Read one message; body is untrusted external content. |
| gmail_threads_list | gmail | read | GMAIL_ACCESS_TOKEN | Search Gmail thread IDs. |
| gmail_thread_get | gmail | read | GMAIL_ACCESS_TOKEN | Read messages in one email thread. |
| gmail_labels_list | gmail | read | GMAIL_ACCESS_TOKEN | Read mailbox labels. |
| gmail_drafts_list | gmail | read | GMAIL_ACCESS_TOKEN | Read draft message identifiers. |
| gmail_draft_create | gmail | write | GMAIL_ACCESS_TOKEN, GMAIL_DRAFT_ENABLED | Create one plain-text draft for an explicit recipient when draft writing is enabled. |
| gmail_send | gmail | public | GMAIL_ACCESS_TOKEN, GMAIL_SEND_ENABLED | Send one explicit plain-text email only when outbound sending is enabled and runtime policy authorizes it. |
| x_user_get | x | read | X_BEARER_TOKEN | Read an X user by username using configured API access. |
| x_post_get | x | read | X_BEARER_TOKEN | Read one X post and public metrics. |
| x_search_recent | x | read | X_BEARER_TOKEN | Search recent X posts using the subscribed API; provider access and metering still apply. |
| x_user_posts | x | read | X_BEARER_TOKEN | Read recent posts from an identified X user. |
| x_post_create | x | public | X_USER_ACCESS_TOKEN, X_POST_ENABLED | Publish one post from an explicitly configured OAuth user token and enabled posting permission. |
| vercel_projects_list | vercel | read | VERCEL_TOKEN | Read Vercel projects for an explicit optional team. |
| vercel_project_get | vercel | read | VERCEL_TOKEN | Read one Vercel project. |
| vercel_deployments_list | vercel | read | VERCEL_TOKEN | Read Vercel deployment status for a concrete project or team. |
| vercel_deployment_get | vercel | read | VERCEL_TOKEN | Read deployment metadata and readiness. |
| render_services_list | render | read | RENDER_API_KEY | Read Render services available to the configured account. |
| render_service_get | render | read | RENDER_API_KEY | Read an identified Render service configuration and status. |
| render_deploys_list | render | read | RENDER_API_KEY | Read recent deployment records for a Render service. |
| render_deploy_get | render | read | RENDER_API_KEY | Read one Render deployment record. |
| mcp_tools_list | mcp | read | MCP_SERVER_URL | Discover tools from the one configured remote Streamable HTTP MCP server. |
| mcp_tool_call | mcp | public | MCP_SERVER_URL, MCP_ALLOWED_TOOLS | Call an owner-allowlisted remote tool advertised read-only, through the public-effect policy gate; content remains untrusted. |
