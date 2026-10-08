import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,validHash,cookieToken,sameOrigin,tokenHash} from './auth.mjs';
import {makeAdapter} from './database.mjs';
import {createHandler} from './http.mjs';
import {safeTransferState} from './transfer.mjs';
import {initialState,readState,mutate} from '../worker/paper.mjs';
test('password hash validates without retaining plaintext',async()=>{
  const hash=await hashPassword('fixture-only-owner-password');
  assert.ok(validHash(hash));assert.ok(!hash.includes('fixture'));
  assert.equal(await verifyPassword('fixture-only-owner-password',hash),true);
  assert.equal(await verifyPassword('wrong',hash),false);
  await assert.rejects(hashPassword('short'));
  assert.equal(cookieToken('__Host-dots_session=bad','__Host-dots_session'),null);
});
test('same-origin writes reject missing and cross-site origins',()=>{
  const request=headers=>new Request('https://dots.example/api/control',{method:'POST',headers});
  assert.equal(sameOrigin(request({}),'https://dots.example'),false);
  assert.equal(sameOrigin(request({Origin:'https://other.example'}),'https://dots.example'),false);
  assert.equal(sameOrigin(request({Origin:'https://dots.example','sec-fetch-site':'cross-site'}),'https://dots.example'),false);
  assert.equal(sameOrigin(request({Origin:'https://dots.example'}),'https://dots.example'),true);
});
test('PostgreSQL adapter preserves CAS and engine state',async()=>{
  let row=null;
  const pool={async query(sql,args=[]) {
    if(sql.startsWith('SELECT'))return{rows:row?[{...row}]:[],rowCount:row?1:0};
    if(sql.startsWith('INSERT')){if(row)return{rowCount:0};row={version:0,payload:args[0]};return{rowCount:1};}
    if(row.version!==args[1])return{rowCount:0};row.payload=args[0];row.version++;return{rowCount:1};
  }};
  const DB=makeAdapter(pool);
  await readState(DB);
  await Promise.all(Array.from({length:6},()=>mutate(DB,s=>{s.test_count=(s.test_count||0)+1;})));
  const result=await readState(DB);assert.equal(result.state.test_count,6);assert.equal(result.version,6);
  assert.throws(()=>DB.prepare('DELETE FROM desk_state'));
});
test('identity spoof cannot bypass owner login; all APIs require session',async()=>{
  const calls=[];
  const handler=createHandler({pool:{async query(){return{rowCount:0};}},env:{},origin:'https://dots.example',worker:{async fetch(){calls.push(1);return new Response('bad');}}});
  for(const path of ['/api/desk','/api/export']) {
    const r=await handler(new Request('https://dots.example'+path,{headers:{'oai-authenticated-user-id':'spoof'}}));assert.equal(r.status,401);
  }
  const write=await handler(new Request('https://dots.example/api/tick',{method:'POST',headers:{'oai-authenticated-user-id':'spoof'}}));assert.equal(write.status,403);
  assert.equal(calls.length,0);
});
test('signed-in requests receive server identity; logout revokes session',async()=>{
  const token='a'.repeat(64);let revoked=false,seen;
  const pool={async query(sql,args){assert.equal(args[0],tokenHash(token));if(sql.startsWith('DELETE')){revoked=true;return{rowCount:1};}return{rowCount:revoked?0:1};}};
  const worker={async fetch(req){seen=req;return new Response('{}');}};
  const handler=createHandler({pool,env:{},worker,origin:'https://dots.example'});
  const headers={Cookie:'__Host-dots_session='+token,Origin:'https://dots.example','oai-authenticated-user-id':'spoof','oai-sites-authorization':'spoof'};
  assert.equal((await handler(new Request('https://dots.example/api/control',{method:'POST',headers,body:'{}'}))).status,200);
  assert.equal(seen.headers.get('oai-authenticated-user-id'),'vps-owner');
  assert.equal(seen.headers.get('oai-sites-authorization'),null);
  const logout=await handler(new Request('https://dots.example/logout',{method:'POST',headers}));
  assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await handler(new Request('https://dots.example/api/desk',{headers}))).status,401);
});
test('migration preserves full financial and memory state, drops secrets, pauses tasks',()=>{
  const state=initialState();state.ledger=[{id:'test'}];state.learning={outcomes:[1]};state.ai_connection={ciphertext:'encrypted'};state.research={enabled:true,lease:{id:'old'},reports:[{status:'running'}]};state.simulation={enabled:true,adaptive:{cash_cents:95000}};state.running=true;state.tick_lease={token:'old'};
  state.gmgn_connection={ciphertext:'encrypted-gmgn'};state.gmgn={epoch:4,lease:{token:'old'},verified_at:123,watchlist:[{address:'public-address'}]};
  const imported=safeTransferState({state});
  assert.equal(imported.cash_cents,state.cash_cents);assert.deepEqual(imported.ledger,state.ledger);assert.deepEqual(imported.learning,state.learning);
  assert.equal(imported.ai_connection,undefined);assert.equal(imported.running,false);assert.equal(imported.halted,true);assert.equal(imported.research.enabled,false);assert.equal(imported.simulation.enabled,false);assert.equal(imported.tick_lease,null);
  assert.throws(()=>safeTransferState({account:{cash:1000},ledger:[]}),/full desk_state/);
  assert.equal(imported.gmgn_connection,undefined);assert.equal(imported.gmgn.lease,null);assert.equal(imported.gmgn.epoch,5);assert.equal(imported.gmgn.verified_at,null);assert.deepEqual(imported.gmgn.watchlist,state.gmgn.watchlist);
});
