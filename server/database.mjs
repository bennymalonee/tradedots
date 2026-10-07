import pg from 'pg';
export async function openDatabase(connectionString) {
  if (!connectionString) throw Error('DATABASE_URL is required');
  const pool = new pg.Pool({connectionString, max: 5, connectionTimeoutMillis: 10000});
  // The original engine's optimistic version check remains atomic in PostgreSQL.
  await pool.query(`CREATE TABLE IF NOT EXISTS desk_state (
    id integer PRIMARY KEY CHECK (id=1), version integer NOT NULL DEFAULT 0, payload text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS owner_sessions (
    token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_guard (
    id integer PRIMARY KEY CHECK (id=1), failures integer NOT NULL DEFAULT 0,
    window_start timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO login_guard(id) VALUES(1) ON CONFLICT DO NOTHING;`);
  return {pool, DB: makeAdapter(pool)};
}
export function makeAdapter(pool) {
  const allowed = new Map([
    ['SELECT version,payload FROM desk_state WHERE id=1', 'SELECT version,payload FROM desk_state WHERE id=1'],
    ['INSERT OR IGNORE INTO desk_state(id,version,payload) VALUES(1,0,?)', 'INSERT INTO desk_state(id,version,payload) VALUES(1,0,$1) ON CONFLICT (id) DO NOTHING'],
    ['UPDATE desk_state SET payload=?,version=version+1 WHERE id=1 AND version=?', 'UPDATE desk_state SET payload=$1,version=version+1 WHERE id=1 AND version=$2']
  ]);
  return {prepare(sql) {
    if (!allowed.has(sql)) throw Error('Unsupported storage statement');
    let args = [];
    const statement = {
      bind(...values) {args = values; return statement;},
      async first() {return (await pool.query(allowed.get(sql), args)).rows[0] ?? null;},
      async run() {return {meta: {changes: (await pool.query(allowed.get(sql), args)).rowCount}};}
    };
    return statement;
  }};
}
