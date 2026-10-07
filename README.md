# DotsTrading on Coolify

This package ports the current DotsTrading dashboard and engine to Node.js and PostgreSQL. It includes private owner login and an optional background monitor. No Cloudflare or ChatGPT Sites access is required at runtime. AI inference uses your server-side OpenAI API key; provider usage is billed separately.

The PostgreSQL adapter preserves the existing single-record, versioned state format. All agent research, simulation and learning history remains in that record. This does **not** add Hindsight, pgvector or semantic memory search. Those can be added independently later. Brokerage paper orders remain manual; the background monitor only fetches data, records research and runs the separate virtual simulation.

## Coolify setup

1. Put this package at the root of the GitHub repository connected to Coolify (or select its subdirectory as the base directory).
2. Create a resource from that repository using **Docker Compose**, with compose path `/docker-compose.yml`. Select the branch containing this package.
3. Let Coolify assign an HTTPS domain to the `dots` service on **port 3000**. Set `APP_ORIGIN` to that exact origin, such as `https://dots.example.com`, with no path. PostgreSQL must have **no public domain or published port**.
4. Set the required runtime secrets below in Coolify. Do not mark them as build arguments, commit them, or paste them into chat. Keep `MONITOR_ENABLED=false` until migration is checked.
5. Deploy. Set the app health-check path to `/healthz`. Sign in at `/login`. If the login rejects requests, check that `APP_ORIGIN` matches the HTTPS URL exactly.
6. After checking/importing data, set `MONITOR_ENABLED=true` and redeploy. The monitor runs at most once per minute, sequentially, with a PostgreSQL lock to avoid duplicate schedulers. AI scheduled rounds remain OFF until explicitly enabled inside Research Room. A working OpenAI key alone does not enable scheduled spending.

### Required secrets

- `POSTGRES_PASSWORD`: random **hex** (32 bytes). It is embedded in a connection URL, so use hex rather than punctuation.
- `OWNER_PASSWORD_HASH`: scrypt hash of your private owner password (at least 16 characters).
- `RESEARCH_ENCRYPTION_KEY`: random 32-byte base64 master key for the dashboard's encrypted API setup. Keep an offline backup. Changing it makes stored API keys unreadable.
- `APP_ORIGIN`: the HTTPS origin of the app assigned by Coolify.

Generate these **on your own terminal**, not in chat:

```bash
openssl rand -hex 32
openssl rand -base64 32
read -r -s -p 'Owner password: ' dots_password
printf '\n'
printf '%s' "$dots_password" | node scripts/password-hash.mjs
unset dots_password
```

Save the first two values and the generated password hash in Coolify secrets. The script works with Node 22+ without installing dependencies. Login cookies are HttpOnly, Secure, SameSite Strict, expire in eight hours, and can be revoked by signing out. Login throttling persists in PostgreSQL. Only authenticated same-origin requests can access private data or change state. Supplied ChatGPT identity headers cannot bypass login.

### Optional provider secrets

- `OPENAI_API_KEY`, `OPENAI_RESEARCH_MODEL` (default `gpt-4.1-mini`). Alternatively use **Research Room → API Setup** after login to save an encrypted key.
- `ALPACA_API_KEY`, `ALPACA_API_SECRET`: paper account only. The broker URL is locked to `https://paper-api.alpaca.markets/v2`.

## Moving the existing Sites data

Do not shut down the current site yet. Take a **full `desk_state.payload` snapshot** from the Sites database admin tools, including positions, balances, configuration, all agent history, simulations and learning. Remove `ai_connection` from the snapshot before transferring it; reconnect the AI key on the VPS. Never place snapshots in GitHub or Docker build context. The dashboard `/api/export` is a ledger export and is **not a full restore snapshot**; the importer deliberately refuses it.

Pause the source desk, simulation, scheduled AI research, and the source automation before taking the final snapshot. Deploy the destination with monitoring disabled. For import, the destination database must be empty: before opening the dashboard or hitting `/api/desk`, copy the private snapshot into the app container and run:

```bash
node scripts/state-transfer.mjs import /tmp/dots.backup.json
```

Run this from the app container's terminal, where `DATABASE_URL` is already set. Delete the temporary snapshot afterward. Import refuses to overwrite an existing account. It preserves history while pausing the destination and clearing source task leases. Broker requests and reconciliation history are retained to prevent duplicate submissions. Verify balances, positions, agent history and broker reconciliation, reconnect keys, then resume explicitly. The old Sites version can remain as a fallback; do not run two active schedules against the same accounts.

## Backups

The `dots-data` volume persists across deployments, but a volume is not a backup. Configure **daily PostgreSQL backups in Coolify**, if supported by your installed version/resource type, to storage outside this VPS. Otherwise schedule a `pg_dump` job to an external backup destination. Test a restore. Back up the encryption key separately; database dumps include encrypted saved API keys and must stay private.

A portable state-only snapshot can also be created from the app container:

```bash
node scripts/state-transfer.mjs export /tmp/dots.backup.json
```

This excludes saved API credentials and is not a replacement for a complete database backup, which also contains session and login-limit tables.

## Local validation

```bash
npm ci
npm run build
npm run test:vps
```

Production requires HTTPS. For local testing only, `NODE_ENV=development` allows an HTTP `APP_ORIGIN` and non-Secure cookies. Do not use that setting in Coolify. An empty database starts with the existing engine's default paper account; it does not automatically copy the hosted site's data.
