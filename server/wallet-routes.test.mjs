import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeApi} from '../worker/api.mjs';
import {initialState} from '../worker/paper.mjs';
import {makeAdapter} from './database.mjs';
import {createHandler} from './http.mjs';

const walletOrigin = 'https://dots.example';
const walletSession = 'a'.repeat(64);
const walletMutationPaths = [
  '/api/wallets/connection', '/api/wallets/discover', '/api/wallets/analyze',
  '/api/wallets/activity', '/api/wallets/watch'
];

function walletFixture(state = initialState()) {
  let row = {version:0, payload:JSON.stringify(state)};
  const pool = {async query(sql, args = []) {
    if (sql.startsWith('SELECT token_hash FROM owner_sessions')) return {rowCount:1, rows:[{token_hash:'fixture'}]};
    if (sql.startsWith('SELECT version,payload FROM desk_state')) return {rowCount:1, rows:[{...row}]};
    if (sql.startsWith('UPDATE desk_state')) {
      if (row.version !== args[1]) return {rowCount:0};
      row = {version:row.version + 1, payload:args[0]};
      return {rowCount:1};
    }
    throw Error('Unexpected fixture SQL');
  }};
  const env = {DB:makeAdapter(pool), GMGN_API_KEY:'fixture-provider-key-never-send',
    RESEARCH_ENCRYPTION_KEY:Buffer.alloc(32, 7).toString('base64')};
  const worker = {fetch:request => routeApi(request, env)};
  return {env, handler:createHandler({pool, env, worker, origin:walletOrigin}),
    state:() => JSON.parse(row.payload)};
}

function walletRequest(path, {method = 'POST', input = {}, headers = {}} = {}) {
  return new Request(walletOrigin + path, {method,
    headers:{'Content-Type':'application/json', ...headers},
    body:['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(input)});
}

async function withoutProviderRequests(operation) {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {calls++; throw Error('Provider request forbidden in route security test');};
  try {await operation(); assert.equal(calls, 0);} finally {globalThis.fetch = original;}
}

test('wallet mutations require a trusted identity before any provider request or storage change', async () => {
  const fixture = walletFixture(), before = fixture.state();
  await withoutProviderRequests(async () => {
    for (const path of walletMutationPaths) {
      const response = await routeApi(walletRequest(path, {headers:{Origin:walletOrigin}}), fixture.env);
      assert.equal(response.status, 403, path);
    }
  });
  assert.deepEqual(fixture.state(), before);
});

test('wallet mutations reject cross-origin and cross-site authenticated requests before provider calls', async () => {
  const fixture = walletFixture(), before = fixture.state();
  await withoutProviderRequests(async () => {
    for (const path of walletMutationPaths) {
      const direct = await routeApi(walletRequest(path, {headers:{
        Origin:'https://attacker.example', 'oai-authenticated-user-id':'owner'
      }}), fixture.env);
      assert.equal(direct.status, 403, path);
      const response = await fixture.handler(walletRequest(path, {headers:{
        Cookie:'__Host-dots_session=' + walletSession, Origin:walletOrigin, 'sec-fetch-site':'cross-site'
      }}));
      assert.equal(response.status, 403, path);
    }
  });
  assert.deepEqual(fixture.state(), before);
});

test('wallet writes reject missing Origin at the VPS boundary despite a valid session', async () => {
  const fixture = walletFixture();
  await withoutProviderRequests(async () => {
    for (const path of walletMutationPaths) {
      const response = await fixture.handler(walletRequest(path, {headers:{Cookie:'__Host-dots_session=' + walletSession}}));
      assert.equal(response.status, 403, path);
    }
  });
});

test('wallet endpoints reject unsupported HTTP methods without contacting providers', async () => {
  const fixture = walletFixture();
  await withoutProviderRequests(async () => {
    const readWrite = await routeApi(walletRequest('/api/wallets', {headers:{'oai-authenticated-user-id':'owner', Origin:walletOrigin}}), fixture.env);
    assert.equal(readWrite.status, 405);
    for (const path of walletMutationPaths) {
      const response = await routeApi(walletRequest(path, {method:'GET', headers:{'oai-authenticated-user-id':'owner'}}), fixture.env);
      assert.equal(response.status, 405, path);
    }
  });
});

test('wallet research rejects invalid addresses, chains and periods before provider calls', async () => {
  const fixture = walletFixture(), before = fixture.state();
  const validAddress = '11111111111111111111111111111111';
  const cases = [
    ['/api/wallets/analyze', {address:'not-a-solana-wallet', period:'7d'}],
    ['/api/wallets/analyze', {address:'1'.repeat(31), period:'7d'}],
    ['/api/wallets/analyze', {address:validAddress, period:'all'}],
    ['/api/wallets/analyze', {address:validAddress, period:['7d']}],
    ['/api/wallets/analyze', {address:validAddress, period:'7d', chain:'eth'}],
    ['/api/wallets/activity', {address:'https://attacker.example', chain:'sol'}],
    ['/api/wallets/discover', {chain:'eth'}],
    ['/api/wallets/watch', {address:'bad', action:'add'}]
  ];
  await withoutProviderRequests(async () => {
    for (const [path, input] of cases) {
      const response = await routeApi(walletRequest(path, {input,
        headers:{Origin:walletOrigin, 'oai-authenticated-user-id':'owner'}}), fixture.env);
      assert.equal(response.status, 400, `${path}: ${JSON.stringify(input)}`);
      const result = await response.json();
      assert.ok(result.error);
      assert.ok(!result.error.includes('fixture-provider-key-never-send'));
    }
  });
  assert.deepEqual(fixture.state(), before);
});

test('cached wallet responses and desk exports whitelist public fields and omit credentials and internal leases', async () => {
  const state = initialState(), address = '11111111111111111111111111111111';
  state.gmgn_connection = {version:1, ciphertext:'fixture-encrypted-provider-secret', iv:'fixture-encryption-iv',
    api_key:'fixture-persisted-api-key', verified_at:Date.now()};
  state.gmgn = {epoch:3, usage:{}, lease:{token:'fixture-private-lease-token', until:Date.now() + 10000},
    watchlist:[{address, label:'Tracked wallet', added_at:Date.now(), api_key:'fixture-raw-watch-key'}],
    discovery:{at:Date.now(), wallets:[{address, label:'Public alias', observed_at:Date.now(),
      provider_response:{api_key:'fixture-raw-discovery-key'}}]},
    reports:[{id:'public-report', address, period:'7d', at:Date.now(), realized_profit:12.5,
      realized_profit_cost:100, buy_count:3, sell_count:2, provider_response:{api_key:'fixture-raw-report-key'}}]};
  const fixture = walletFixture(state), before = fixture.state();
  const forbidden = ['fixture-provider-key-never-send', 'fixture-encrypted-provider-secret',
    'fixture-encryption-iv', 'fixture-persisted-api-key', 'fixture-private-lease-token',
    'fixture-raw-watch-key', 'fixture-raw-discovery-key', 'fixture-raw-report-key'];
  await withoutProviderRequests(async () => {
    for (const path of ['/api/wallets', '/api/export']) {
      const response = await fixture.handler(walletRequest(path, {method:'GET',
        headers:{Cookie:'__Host-dots_session=' + walletSession}}));
      assert.equal(response.status, 200, path);
      const body = await response.text();
      for (const secret of forbidden) assert.ok(!body.includes(secret), `${path} leaked ${secret}`);
      if (path === '/api/wallets') {
        const value = JSON.parse(body);
        assert.equal(value.reports[0].realized_profit, 12.5);
        assert.equal(value.watchlist[0].address, address);
        assert.equal(value.connection.readonly, true);
      }
    }
  });
  assert.deepEqual(fixture.state(), before);
});

test('an untrusted identity header cannot expose private cached wallet research through the VPS', async () => {
  const fixture = walletFixture();
  await withoutProviderRequests(async () => {
    for (const path of ['/api/wallets', '/api/export']) {
      const response = await fixture.handler(walletRequest(path, {method:'GET',
        headers:{'oai-authenticated-user-id':'spoof'}}));
      assert.equal(response.status, 401, path);
    }
  });
});

test('malformed wallet JSON cannot echo a submitted API key in the error response', async () => {
  const fixture = walletFixture(), secret = 'fixture-submitted-api-key-must-not-echo';
  await withoutProviderRequests(async () => {
    const request = new Request(walletOrigin + '/api/wallets/connection', {method:'POST',
      headers:{'Content-Type':'application/json', Origin:walletOrigin, 'oai-authenticated-user-id':'owner'},
      body:'{"api_key":"' + secret + '", malformed'});
    const response = await routeApi(request, fixture.env);
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.ok(!body.includes(secret));
    assert.ok(JSON.parse(body).error);
  });
});

test('GMGN rate limits return HTTP 429 and block subsequent provider calls until reset', async () => {
  const fixture = walletFixture(), original = globalThis.fetch;
  const reset = Math.floor(Date.now() / 1000) + 120;
  let calls = 0;
  globalThis.fetch = async (target, options) => {
    calls++;
    const url = new URL(target);
    assert.equal(url.origin, 'https://openapi.gmgn.ai');
    assert.equal(url.pathname, '/v1/user/smartmoney');
    assert.equal(options.method, 'GET');
    return Response.json({code:429, error:'RATE_LIMIT_EXCEEDED'}, {status:429,
      headers:{'x-ratelimit-reset':String(reset)}});
  };
  try {
    const headers = {Origin:walletOrigin, 'oai-authenticated-user-id':'owner'};
    const first = await routeApi(walletRequest('/api/wallets/discover', {headers}), fixture.env);
    assert.equal(first.status, 429);
    assert.ok(!(await first.text()).includes('fixture-provider-key-never-send'));
    assert.ok(fixture.state().gmgn.cooldown_until >= reset * 1000);
    const second = await routeApi(walletRequest('/api/wallets/discover', {headers}), fixture.env);
    assert.notEqual(second.status, 200);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
