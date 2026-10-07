# DotsTrading

**A private market research and paper-trading desk for your VPS.**

<p align="center">
  <img src="web/characters.png" alt="The four DotsTrading mascots" width="640">
</p>

DotsTrading brings market monitoring, six agent roles, experimental strategy learning, and isolated trading simulations into one dashboard. Deploy it through Coolify with Docker Compose and PostgreSQL. AI research runs through your own OpenAI API connection.

**Node.js 22+ · PostgreSQL 17 · Docker Compose · MIT License**

[Deploy with Coolify](#deploy-with-coolify) · [Configuration](#configuration) · [Data migration](#data-migration) · [Troubleshooting](#troubleshooting)

## What you can do

| Capability | How it works |
| --- | --- |
| Market monitoring | Collects quotes and tracks source health, stale data, and rate limits. |
| Six agent roles | ATLAS, ORION, TITAN, NOVA, VEGA, and LUNA cover evidence, research, signals, sizing, and risk. |
| AI research | Runs six sequential model reviews using shared evidence and recent report history. Requires an OpenAI API key. |
| Adaptive research | Scores recorded forecasts against future observations and adjusts experimental strategy weights after enough outcomes. |
| Isolated simulation | Compares adaptive and fixed-momentum virtual accounts with modeled spreads, fees, and risk limits. |
| Paper brokerage | Supports authenticated manual proposals through the locked Alpaca Paper endpoint. |
| Persistent history | Stores account state, agent reports, forecasts, simulation results, and alerts in PostgreSQL. |

**Execution scope:** background monitoring does not submit broker orders. AI reports do not change risk limits or place trades. Simulated fills are separate from the main account and brokerage. Research and simulation results do not establish future profitability.

Memory currently uses bounded stored history. Hindsight, vector search, and model retraining are not included.

## Architecture

```mermaid
flowchart LR
    Browser[Private dashboard] -->|HTTPS| Proxy[Coolify proxy]
    Proxy --> App[Dots Node.js app]
    App --> DB[(PostgreSQL)]
    Monitor[Background monitor] --> App
    App --> Sources[Market data sources]
    App -->|Optional AI research| AI[OpenAI API]
    App -->|Manual paper orders| Broker[Alpaca Paper]
```

The dashboard, API, and optional scheduler run in the `dots` service. PostgreSQL runs in the `postgres` service with a persistent `dots-data` volume. Only the app needs a public domain; keep the database private.

## Deploy with Coolify

### 1. Prepare your environment

You need a Linux VPS with Docker and Coolify, a GitHub source connected to Coolify, and an HTTPS domain for the app. Coolify can assign a domain if your installation supports it.

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
| `ALPACA_API_KEY` | Empty | Alpaca Paper and market-data credential |
| `ALPACA_API_SECRET` | Empty | Matching Alpaca credential secret |

The Compose configuration locks the broker endpoint to `https://paper-api.alpaca.markets/v2`. OpenAI API usage is billed separately from ChatGPT subscriptions. VPS, backup storage, and provider charges depend on your services.

## Authentication and private data

Dots uses a single owner password with salted scrypt verification. Successful login creates an eight-hour session; PostgreSQL stores the token hash. Production cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`. Logout revokes the session, and login throttling persists across restarts.

Private dashboard and API requests require a session. State-changing requests also require the configured origin. The public `/healthz` endpoint reports service readiness without exposing desk data. Multi-user roles, password recovery, and MFA are not implemented.

API Setup verifies model access and encrypts saved keys with AES-256-GCM. Saved keys are not returned to the browser or included in state-transfer exports. Keep `RESEARCH_ENCRYPTION_KEY` stable: replacing it makes previously saved keys unreadable.

Commit application code and placeholder configuration only. Keep passwords, provider keys, certificates, database dumps, exports, and account snapshots outside Git. Ignore rules help prevent accidental inclusion but do not detect every possible secret.

## Data migration

Use a **full desk-state snapshot** when moving an existing installation. The dashboard ledger export is useful for analysis but does not contain everything needed to restore an account.

1. Pause source monitoring, simulation, scheduled AI research, and external automation before taking the final snapshot.
2. Export the full state. For a Sites installation, obtain the JSON stored in `desk_state.payload` through its database administration tools. Remove `ai_connection` before transferring it; reconnect the AI key at the destination.
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

The exporter excludes saved AI credentials and refuses to overwrite an existing file. Download the snapshot privately, then remove the temporary copy. This supplements full database backups; it does not include session or login-throttling tables.

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
