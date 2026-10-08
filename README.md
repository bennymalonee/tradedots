# DotsTrading

**A private market research and paper-trading desk for your VPS.**

<p align="center">
  <img src="web/characters.png" alt="The four DotsTrading mascots" width="640">
</p>

DotsTrading brings market monitoring, six agent roles, experimental strategy learning, and isolated trading simulations into one dashboard. Deploy it through Coolify with Docker Compose and PostgreSQL. AI research runs through your own OpenAI API connection; optional GMGN wallet research uses public Solana trading data.

**Node.js 22+ · PostgreSQL 17 · Docker Compose · MIT License**

[Deploy with Coolify](#deploy-with-coolify) · [Wallet research](#wallet-research-with-gmgn) · [Configuration](#configuration) · [Data migration](#data-migration) · [Troubleshooting](#troubleshooting)

## What you can do

| Capability | How it works |
| --- | --- |
| Market monitoring | Collects quotes and tracks source health, stale data, and rate limits. |
| Six agent roles | ATLAS, ORION, TITAN, NOVA, VEGA, and LUNA cover evidence, research, signals, sizing, and risk. |
| AI research | Runs six sequential model reviews using shared evidence and recent report history. Requires an OpenAI API key. |
| Wallet research | Discovers public GMGN smart-money wallets and compares a watchlist with reported PnL and recent Solana trade history. Requires a GMGN API key. |
| Adaptive research | Scores recorded forecasts against future observations and adjusts experimental strategy weights after enough outcomes. |
| Isolated simulation | Compares adaptive and fixed-momentum virtual accounts with modeled spreads, fees, and risk limits. |
| Paper brokerage | Supports authenticated manual proposals through the locked Alpaca Paper endpoint. |
| Searchable memory | Archives research, forecast outcomes, trade lessons, and agent decisions in PostgreSQL with full-text and symbol search. |
| Readiness checks | Reports functional simulation checks, all six agent histories, quote freshness, configuration, and evidence gaps. |
| Performance comparison | Separates realized and unrealized net results, fees, returns, and sampled drawdown for both virtual accounts. |

**Execution scope:** background monitoring does not submit broker orders. AI reports do not change risk limits or place trades. Simulated fills are separate from the main account and brokerage. Research and simulation results do not establish future profitability.

The active desk keeps bounded recent history; the memory archive persists research, scored forecasts, and simulated trade lessons separately. Detailed decision records are retained for 14 days. Hindsight, vector search, and model retraining are not included.

## Architecture

```mermaid
flowchart LR
    Browser[Private dashboard] -->|HTTPS| Proxy[Coolify proxy]
    Proxy --> App[Dots Node.js app]
    App --> DB[(PostgreSQL)]
    Monitor[Background monitor] --> App
    App --> Sources[Market data sources]
    App -->|Optional AI research| AI[OpenAI API]
    App -->|Optional wallet research| Wallets[GMGN public data API]
    App -->|Manual paper orders| Broker[Alpaca Paper]
```

The dashboard, API, and optional scheduler run in the `dots` service. PostgreSQL runs in the `postgres` service with a persistent `dots-data` volume. Only the app needs a public domain; keep the database private.

## Evidence workspace

The sidebar groups all dashboard sections into **Workspace**, **Research**, **Trading**, **Safety**, and **Settings**. It collapses on desktop and opens as a drawer on smaller screens. Memory, readiness, and performance links select their corresponding tabs; risk settings, AI connection, and GMGN connection links open the setup dialogs. **Research → Wallet research** opens the wallet watchlist. Ledger export and sign-out stay at the bottom of the menu.

The **Desk Evidence & Readiness** panel has five views:

- **Agent activity:** recorded task results, timestamps, quote and sizing inputs, citations, recent research reviews, and memory/handoff counts. A forecast scorecard compares recent Brier error with a constant 50% forecast and shows calibration bins with their sample support. Waiting, vetoed, and stale activity are labeled explicitly.
- **Memory:** search by keyword or symbol, then filter by agent and record type. Expand a result to inspect its supporting evidence and outcome. Use **Archive available history** to backfill the history still present in the desk.
- **Readiness:** run isolated synthetic checks and save a snapshot of current configuration and evidence. Warnings identify missing prerequisites; failures identify broken checks. This does not contact AI providers or execute orders.
- **Performance:** compare equal-capital virtual accounts after modeled fees. Realized net results remain visible when stale position marks make total equity unavailable. Both accounts need at least 30 closed trades before the report labels the comparison preliminary; that threshold does not establish statistical significance.
- **Validation:** manually select a momentum candidate using earlier recorded bid/ask observations, freeze its settings, and test on the later period. The report compares net results with a buy-and-hold baseline and includes modeled fees, spread and adverse slippage. It requires at least 120 valid observations per symbol and does not modify the active strategy. This is one chronological holdout, not independent validation of all six agents or proof of profitability.

Each AI review receives up to three role-prioritized archived reviews, simulated trade lessons or scored forecasts for the current primary symbol, and can cite their archive IDs. Earlier agents' replies are passed to later reviews, and that handoff is recorded. Simulation decision records also include recent outcome summaries for explanation. Memories remain untrusted evidence; retrieval does not change execution permissions, strategy weights, or risk limits. Trade lessons describe observed outcomes, not proven causes.

No existing history can be recovered after it has already been discarded. Archive capture begins with available records after this version is installed, and continues on monitoring cycles and completed research rounds. The archive uses PostgreSQL full-text search without embedding API charges. AI calls that include retrieved context still incur normal provider charges.

## Wallet research with GMGN

Use this workspace to discover and evaluate public Solana wallets before considering a strategy. Dots calls the official GMGN data API directly; installing the GMGN CLI is unnecessary. It uses an API key for public smart-money discovery, wallet activity, and PnL. Personal GMGN follow-list synchronization, signed holdings queries, and live copy trading are not included. Dots does not accept or store a GMGN private signing key or wallet seed phrase.

### Create and connect an API key

1. Sign in to Dots and open **Settings → GMGN connection**. Generate the public key for your GMGN application. The browser downloads the matching private signing PEM for you to keep locally; Dots does not upload or save that private key. This authentication key pair is separate from your crypto wallet keys.
2. Open the provided [GMGN API creation link](https://gmgn.ai/ai/generateapi) and sign in to your own GMGN account. The link supplies the public key. If copying it manually, include the full PEM with its `BEGIN PUBLIC KEY` and `END PUBLIC KEY` lines. See the [official key guide](https://docs.gmgn.ai/index/generate-public-key).
3. Create your GMGN API key. If GMGN offers permission choices, select data access and leave trading disabled. GMGN supports IPv4 API requests; ensure your VPS has working IPv4 outbound access. Account eligibility and current plan limits are determined by GMGN.
4. Paste only the API key into the authenticated Dots connection dialog and save it, or set **`GMGN_API_KEY` as a Coolify runtime secret** and redeploy. Never commit a real key. Browser setup encrypts the saved API key using the existing `RESEARCH_ENCRYPTION_KEY`; preserve that master key when updating the app.
5. Open **Research → Wallet research**, discover public smart-money wallets or add a public Solana address, then select a wallet and request its 7-day or 30-day analysis. Use **Load recent trades** for a separate history sample.

The watchlist holds up to **10 wallets**. Research requests are manual, with at least **10 seconds between provider calls** and a ceiling of **100 calls per UTC day**. Provider limits may be lower; Dots pauses requests during a rate-limit cooldown. Each discovery, connection check, PnL analysis, or recent-trade request uses a provider call; cached views do not. Background market monitoring does not continuously poll the wallet workspace.

Reports compare **7-day and 30-day reported realized PnL** and inspect a bounded recent trade history. A missing value remains unknown. A provider's history may omit earlier trades, transfers, other chains, or activity outside its coverage, so the report is not a complete account audit. A profitable wallet's past results do not establish that copying it would be profitable: followers enter later and may pay different fees or receive different prices.

This connector does not create simulated copy-trade profits. A future paper-copy experiment needs an execution model using the observed signal delay, available liquidity, fees, and adverse slippage before its returns can be compared with the leader's reported results. Dots does not submit wallet trades or broker orders from this workspace.

The provider contract was reviewed against the official MIT-licensed [GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills/tree/4575ef539e6a3115fa0481d41285cb79e77970bf). GMGN service access and data use remain subject to its own terms and plans. This repository contains application code and placeholder configuration; no personal watchlists, account data, or real wallet reports are committed.

## Deploy with Coolify

### 1. Prepare your environment

You need a Linux VPS with Docker and Coolify, a GitHub source connected to Coolify, and an HTTPS domain for the app. Coolify can assign a domain if your installation supports it.

A VPS with **2 CPU cores and 8 GB RAM** is a reasonable starting point for this app and PostgreSQL; AI inference runs through an external API. Allow additional capacity for Coolify, other services, backups, and image builds. GitHub changes appear on your VPS only after you deploy the new commit.

Clone the repository on a machine with **Node.js 22+ and OpenSSL** to generate the required secrets:

```bash
git clone https://github.com/bennymalonee/tradedots.git
cd tradedots
```

### 2. Generate your secrets

Run each command separately in a private terminal. Save its output in your password manager and the matching Coolify runtime variable.

**Database password → `POSTGRES_PASSWORD`**

```bash
openssl rand -hex 32
```

**API-key encryption master key → `RESEARCH_ENCRYPTION_KEY`**

Generate this only for a new installation. If the app already has an encryption master key, keep its existing value when adding GMGN or updating the app.

```bash
openssl rand -base64 32
```

**Owner password hash → `OWNER_PASSWORD_HASH`**

Use Bash for the following commands. The password prompt hides your input; the script prints only the hash. No dependency installation is needed for this script.

```bash
read -r -s -p 'Choose an owner password (at least 16 characters): ' dots_password
printf '\n'
printf '%s' "$dots_password" | node scripts/password-hash.mjs
unset dots_password
```

Use your original password to sign in. Store the generated hash in Coolify.

### 3. Create the Coolify resource

1. Create a resource from the connected GitHub repository.
2. Select branch **`main`**, build pack **Docker Compose**, and compose file **`/docker-compose.yml`**. The base directory is the repository root.
3. Assign an **HTTPS domain** to the `dots` service, targeting container port **`3000`**.
4. Add the required variables from [Configuration](#configuration). Set `APP_ORIGIN` to the exact HTTPS origin, such as `https://dots.example.com`, without a path or trailing slash.
5. Keep `MONITOR_ENABLED=false` during initial setup. Set the app health-check path to **`/healthz`**.
6. Deploy and wait for both services to become healthy.

Set credentials as **runtime secrets**, not build arguments. Do not publish a database port or assign a domain to `postgres`.

### 4. Choose how to initialize the desk

**Fresh installation:** open the app domain, sign in, and review the dashboard. A new database starts with the default virtual account.

**Existing installation:** complete [Data migration](#data-migration) **before opening the dashboard**. Reading the desk initializes an empty account, and the importer refuses to overwrite existing state.

### 5. Connect providers and enable monitoring

After verifying the desk, set `MONITOR_ENABLED=true` in Coolify and redeploy. The scheduler runs sequential cycles with at least 60 seconds between completed cycles. Dashboard refreshes can also request updates; shared state prevents overlapping collection.

For AI research, add `OPENAI_API_KEY` in Coolify or use **Research Room → API Setup** after signing in. Start with the free workflow preview, then run a manual AI round once fresh quotes are available. The preview uses programmed checks; it does not call an AI model.

For optional wallet research, add `GMGN_API_KEY` in Coolify or use **Settings → GMGN connection**. Follow [Wallet research with GMGN](#wallet-research-with-gmgn) for key creation and call limits. This connection does not require enabling the background monitor.

Scheduled paid AI research stays off until you explicitly enable it in the dashboard. The configurable daily round cap bounds requests, not a fixed dollar amount. Set provider billing limits separately.

## Configuration

Use [`.env.example`](.env.example) as a reference. Real values belong in Coolify runtime configuration.

### Required

| Variable | Value | Handling |
| --- | --- | --- |
| `APP_ORIGIN` | Exact HTTPS origin assigned to `dots` | Runtime configuration |
| `POSTGRES_PASSWORD` | Random hex generated above | Secret; hex avoids URL-escaping issues |
| `OWNER_PASSWORD_HASH` | Output of the password-hash script | Secret; never use the plaintext password here |
| `RESEARCH_ENCRYPTION_KEY` | Base64-encoded random 32-byte key | Secret; back up separately from the database |

Docker Compose builds `DATABASE_URL` from the database configuration. You do not need to set it separately for this deployment.

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONITOR_ENABLED` | `false` | Enables the background monitor when set to `true` |
| `MONITOR_INTERVAL_SECONDS` | `60` | Delay between cycles; values below 60 are clamped |
| `OPENAI_API_KEY` | Empty | AI research provider credential |
| `OPENAI_RESEARCH_MODEL` | `gpt-4.1-mini` | Research model; requires access on your API account |
| `GMGN_API_KEY` | Empty | Official GMGN public wallet research credential; never supply a private signing key |
| `ALPACA_API_KEY` | Empty | Alpaca Paper and market-data credential |
| `ALPACA_API_SECRET` | Empty | Matching Alpaca credential secret |

The Compose configuration locks the broker endpoint to `https://paper-api.alpaca.markets/v2`. OpenAI API usage is billed separately from ChatGPT subscriptions. VPS, backup storage, and provider charges depend on your services.

## Authentication and private data

Dots uses a single owner password with salted scrypt verification. Successful login creates an eight-hour session; PostgreSQL stores the token hash. Production cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`. Logout revokes the session, and login throttling persists across restarts.

Private dashboard and API requests require a session. State-changing requests also require the configured origin. The public `/healthz` endpoint reports service readiness without exposing desk data. Multi-user roles, password recovery, and MFA are not implemented.

API Setup verifies model access and encrypts saved AI keys with AES-256-GCM. GMGN connection setup uses the same encryption master key for its saved API key. Saved credentials are not returned to the browser or included in state-transfer exports. Keep `RESEARCH_ENCRYPTION_KEY` stable: replacing it makes previously saved keys unreadable.

Commit application code and placeholder configuration only. Keep passwords, provider keys, certificates, database dumps, exports, and account snapshots outside Git. Ignore rules help prevent accidental inclusion but do not detect every possible secret.

## Data migration

Use a **full desk-state snapshot** when moving an existing installation. The dashboard ledger export is useful for analysis but does not contain everything needed to restore an account. To move an existing searchable memory archive as well, restore a complete PostgreSQL backup: state snapshots do not include the separate `agent_memory` table.

1. Pause source monitoring, simulation, scheduled AI research, and external automation before taking the final snapshot.
2. Export the full state. For a Sites installation, obtain the JSON stored in `desk_state.payload` through its database administration tools. Remove saved provider credentials before transferring it; reconnect AI and GMGN keys at the destination.
3. Deploy the destination with `MONITOR_ENABLED=false`. Keep its database empty and do not open the dashboard yet.
4. Transfer the snapshot privately into the `dots` container, at a path readable by the app user. In the app terminal, run:

   ```bash
   node scripts/state-transfer.mjs import /tmp/dots.backup.json
   ```

5. Delete the temporary snapshot. Check balances, positions, agent history, simulation records, and broker reconciliation. Reconnect credentials and explicitly resume the relevant controls before enabling the scheduler.

Import preserves history, pauses the destination desk and simulation, disables scheduled AI research, and clears old task leases. It refuses to overwrite an existing account. Keep the source available until verification is complete, and avoid running two active schedules against the same accounts.

## Backups and maintenance

The `dots-data` volume survives normal redeployment. Deleting that volume deletes the database; it is not a backup.

Schedule daily PostgreSQL backups to storage outside the VPS. Use Coolify's backup features if available for your resource type, or an external `pg_dump` job. Protect database dumps, back up the encryption key separately, and test restoration.

To create a portable state snapshot, run this in the app container:

```bash
node scripts/state-transfer.mjs export /tmp/dots.backup.json
```

The exporter excludes saved provider credentials and refuses to overwrite an existing file. Download the snapshot privately, then remove the temporary copy. This supplements full database backups; it does not include the memory archive, session, or login-throttling tables.

Before updating the app, take a backup and review the changes. Redeploy the desired commit through Coolify, then check service health and dashboard data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Compose reports a missing variable | Set all four required variables in Coolify runtime configuration. |
| Login returns `403` or requests return `421` | Match `APP_ORIGIN` to the browser's exact HTTPS origin and ensure the proxy forwards that domain as the Host header. |
| Login returns `401` | Use the original owner password, and verify that `OWNER_PASSWORD_HASH` contains the generated scrypt hash. |
| Login returns `429` | Wait until the 15-minute login-limit window expires. |
| Database or app remains unhealthy | Check `postgres` logs and its health check. Changing the password variable alone does not change a password in an already initialized database. |
| Import says the destination is not empty | Use a separate empty destination database. Back up existing data; the importer intentionally does not overwrite it. |
| Quotes are missing or stale | Check source status, market hours, provider credentials, and any rate-limit retry time. |
| AI research waits for quotes | Connect market data and wait for a fresh eligible stock or crypto quote. |
| A saved AI key cannot be opened | Restore the matching encryption master key or reconnect the API key through API Setup. |
| GMGN is disconnected | Save an API key through GMGN connection setup, or set `GMGN_API_KEY` in Coolify and redeploy. |
| GMGN returns `401` or `403` | Check the key, account access, and IPv4 outbound connectivity. |
| GMGN requests are paused | Wait for the displayed cooldown or daily reset. Repeated requests do not clear the provider's limit. |
| A saved GMGN key cannot be opened | Restore the matching `RESEARCH_ENCRYPTION_KEY` or reconnect the API key; do not generate a replacement master key as a routine fix. |
| Background monitoring is inactive | Check `MONITOR_ENABLED=true` and redeploy. Only one scheduler instance holds the PostgreSQL lock. |

## Development

Install dependencies, build the embedded application, and run the VPS checks:

```bash
npm ci
npm run build
npm run test:vps
```

To run locally, configure a PostgreSQL `DATABASE_URL`, the required owner-password hash, encryption key, and `APP_ORIGIN` before `npm start`. For local HTTP testing only, `NODE_ENV=development` permits an HTTP origin and non-Secure cookies. Production requires HTTPS.

| Path | Contents |
| --- | --- |
| `web/` | Dashboard, styles, assets, and agent animations |
| `worker/` | Market APIs, paper engine, learning, simulation, and AI research |
| `server/` | Node.js server, PostgreSQL adapter, authentication, and VPS checks |
| `scripts/` | Build, password-hash, and state-transfer utilities |
| `docker-compose.yml` | Coolify app and PostgreSQL services |

## License

Released under the [MIT License](LICENSE).
