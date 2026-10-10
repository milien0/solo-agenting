# Mac Mini setup

The official 30-day challenge starts on the Mac Mini after migration, necessary account setup, and funding readiness. Work on the Windows development machine is preparation. No setup or background command starts the challenge automatically.

## Automatic preparation

Put the project/export on the Mac Mini, install Node.js 24.13 or newer and Codex, then run from the project directory:

```sh
npm run setup
codex login status
npm run doctor
npm run background:start
```

`npm run setup` installs missing project dependencies and preserves existing private `.env` configuration. It copies the selected model from the local Codex configuration without copying authentication files and detects existing GitHub CLI access. When `SOLANA_WALLET_ADDRESS` is absent, it creates or reuses a local Ed25519 Solana wallet and fills the public address/mainnet RPC settings. An existing configured public address is retained; that alone does not establish custody on this Mac. Setup does not move money, connect a debit card, complete another person's account identity checks, or start the clock.

The default vault is `~/.solo-agentic/vault`, outside the repository. `solana-wallet.json` contains AES-256-GCM encrypted private PKCS8 material, and `wallet-encryption.key` contains its 32-byte encryption key. Both files are needed for recovery. On macOS, the directory has mode 700 and the files have mode 600. The key is stored under the same OS user's file permissions, rather than hardware/Keychain custody; anyone who can read both files can access the wallet material. Back up the complete vault privately. Only the public address/status is returned to the CLI or wallet tool, and no private-key export or signing operation is exposed. `SOLO_VAULT_DIR` can select a different private directory outside the project.

The background command selects macOS launchd and registers user agent `com.soloagentic.runtime`. Open [the dashboard](http://127.0.0.1:4310) and check the task queue, readiness, errors, and a completed model task. Service health alone does not establish model entitlement. The `wallet_provision` capability also provisions/reuses the private local vault and returns only public information. The catalog has 147 capabilities, with 67 configuration-ready before provider credentials; existing GitHub CLI access adds 18. RPC/provider setup changes the live count shown by `doctor`.

## Owner steps that require identity, consent, or funds

1. **Model access.** If the Mac lacks a Codex login, complete `codex login`. Select an `EVE_MODEL` available to that account. The development account uses `gpt-6.1-sol`; its rejection of `gpt-6-luna-fast` does not establish another account's entitlements. The agent verifies access with a real completed task. A hosted/API model instead needs a private server credential.
2. **Delegated accounts.** Supply the intended email, Stripe, debit-card/provider access, and any social or distribution account that a selected experiment actually needs. Complete required interactive sign-in, OAuth consent, personal/business verification, and card/payment-provider identity checks yourself. The agent can inventory missing access, prepare offers/artifacts, and complete work that available tools support. It cannot invent consent, access your funds from a public address, or complete your identity as you.
3. **Funding and start.** Check the setup's public Solana address and wallet ownership, fund the planned USD 100 SOL, and establish the USD 100 debit-card budget with evidence. Confirm actual balances, action scopes, outstanding commitments, and working model access. Then press **Start challenge** on the Mac Mini. Planned USD 200 capital and an unfunded wallet are not verified assets.

The current Solana adapters read finalized account data. Wallet creation does not add signing, trading, transfers, card purchases, payouts, automatic customer charges, or refund mutations. An earning approach that needs one of those operations needs an implemented, authorized adapter. Enable public/financial flags only for the actual operations/accounts delegated to the application; keep unrelated scopes closed.

For local GitHub access, `GITHUB_AUTH_FROM_GH=true` reuses the operating user's existing `gh` login without printing or writing its token to the project. A Mac does not inherit the Windows user's native login. Use `gh auth login` on the Mac when needed, or configure a scoped private `GITHUB_TOKEN`. Other account scopes and flags are listed in the [tool catalog](tool-library.md).

## Private migration and wallet continuity

A public clone contains source, not your private runtime state or wallet. Use a fresh Mac checkout/bootstrap so dependencies and eve resources are prepared for macOS. Preserve useful preparation through a reviewed private artifact/memory handoff. If retaining a complete Windows state backup, stop its service first and keep that backup separate for inspection; do not assume Windows `.eve/` compiled snapshots or accepted sessions can replay on the Mac. Do not move Windows `node_modules/`. Existing task evidence and provider references must be inspected before any external action is retried.

If retaining a wallet already created on Windows, its complete vault is a separate private owner-controlled transfer: preserve both `solana-wallet.json` and `wallet-encryption.key`, apply private filesystem permissions, and check that the Mac's public address matches before funding. A missing or invalid vault is an attention item, not permission to replace an existing funded wallet. Do not put vault contents, seeds, private keys, provider tokens, or card details into Git, a model prompt, an agent artifact, or a public export. If creating a new unfunded wallet on the Mac instead, treat it as a new address and verify it before funding; copying a public address alone does not copy ownership.

Keep the Mac Mini powered, awake, connected, and in the logged-in user session for local operation. Verify launchd recovery after a restart and inspect the dashboard's task evidence. Windows supervision has been observed on the development host; Mac uptime is established on the Mac after installation. Cloud hosting has not been inferred or claimed.

See the [deployment guide](deployment.md) for supervision, logs, state backup, Docker, and model budget limits, and the [operating model](operating-model.md) for challenge accounting and lawful autonomous execution.
