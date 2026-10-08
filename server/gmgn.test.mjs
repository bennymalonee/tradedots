import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gmgnSummary,getWalletResearch,gmgnConnection,gmgnDiscover,gmgnAnalyze,gmgnActivity,gmgnWatch} from '../worker/gmgn.mjs';
import {initialState} from '../worker/paper.mjs';

const ADDRESS='11111111111111111111111111111111';
const OTHER='So11111111111111111111111111111111111111112';
const FIXTURE_KEY='fixture-GMGN-key-1234567890';
const ENCRYPTION=Buffer.alloc(32,17).toString('base64');
const NOW=Date.parse('2026-10-08T12:00:00Z');
const envelope=value=>new Response(JSON.stringify({code:0,data:{code:0,data:value}}),{headers:{'Content-Type':'application/json'}});
const discovery=()=>envelope({list:[{maker:ADDRESS,side:'buy',maker_info:{name:'Fixture wallet'}}]});
function fixtureDB(state=initialState(NOW)){
 let row={version:0,payload:JSON.stringify(state)};
 return{prepare(sql){let args=[];const statement={bind(...values){args=values;return statement;},async first(){return {...row};},async run(){assert.ok(sql.startsWith('UPDATE desk_state'));if(args[1]!==row.version)return{meta:{changes:0}};row={version:row.version+1,payload:args[0]};return{meta:{changes:1}};}};return statement;},state(){return JSON.parse(row.payload);}};
}
function env(state,extra={}){return{DB:fixtureDB(state),GMGN_API_KEY:FIXTURE_KEY,RESEARCH_ENCRYPTION_KEY:ENCRYPTION,...extra};}
function clock(t){let now=NOW;t.mock.method(Date,'now',()=>now);return{advance(ms){now+=ms;},now(){return now;}};}

test('cached wallet research has no provider queries and rejects malformed Solana inputs',async t=>{
 clock(t);const e=env();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not query');});
 assert.equal((await getWalletResearch(e)).connection.configured,true);
 for(const address of ['1'.repeat(31),'1'.repeat(33),'z'.repeat(44),'0'.repeat(32),'https://example.com'])await assert.rejects(gmgnAnalyze(e,{address}),/32-byte/);
 await assert.rejects(gmgnAnalyze(e,{address:ADDRESS,chain:'base'}),/Solana only/);
 await assert.rejects(gmgnAnalyze(e,{address:ADDRESS,period:'all'}),/7d or 30d/);
 await assert.rejects(gmgnWatch(e,{action:'add',address:ADDRESS,label:'x'.repeat(61)}),/60 characters/);
 await gmgnWatch(e,{action:'add',address:ADDRESS,label:'Fixture'});await gmgnWatch(e,{action:'add',address:ADDRESS,label:'Changed'});
 const data=await getWalletResearch(e);assert.equal(data.watchlist.length,1);assert.equal(data.watchlist[0].label,'Changed');assert.equal(calls,0);
 await gmgnWatch(e,{action:'remove',address:ADDRESS});assert.equal((await getWalletResearch(e)).watchlist.length,0);
});
test('GMGN auth and period PnL schema match official readonly endpoints',async t=>{
 const time=clock(t),e=env();const calls=[];
 t.mock.method(globalThis,'fetch',async(target,options)=>{const request=new URL(target);calls.push({request,options});assert.equal(request.origin,'https://openapi.gmgn.ai');assert.equal(options.headers['X-APIKEY'],FIXTURE_KEY);assert.equal(options.headers['X-Signature'],undefined);assert.equal(request.searchParams.get('timestamp'),String(time.now()/1000));assert.match(request.searchParams.get('client_id'),/^[0-9a-f-]{36}$/);assert.equal(options.redirect,'error');assert.ok(options.signal);return envelope({list:[{wallet_address:ADDRESS,realized_profit:'25',realized_profit_cost:'100',buy:'3',sell:'2',total_profit:'999999',secret:'private provider field'}]});});
 const result=await gmgnAnalyze(e,{address:ADDRESS,period:'7d',host:'https://example.com'});
 assert.equal(calls[0].request.pathname,'/v1/user/wallet_profits');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{chain:'sol',period:'7d',wallet_addresses:[ADDRESS]});
 const report=result.reports[0];assert.equal(report.realized_profit,25);assert.equal(report.realized_roi,.25);assert.equal(report.buy_count,3);assert.equal(report.sell_count,2);assert.equal(report.history_status,'not_loaded');assert.equal(report.total_profit,undefined);
 assert.ok(!JSON.stringify(result).includes('private provider field'));assert.ok(!JSON.stringify(result).includes(FIXTURE_KEY));
 await gmgnAnalyze(e,{address:ADDRESS,period:'7d'});assert.equal(calls.length,1);assert.equal(e.DB.state().gmgn.usage['2026-10-08'],1);
 time.advance(10001);t.mock.method(globalThis,'fetch',async()=>envelope({list:[{wallet_address:ADDRESS,total_profit:'1234',buy:'1',sell:'0'}]}));
 const missing=await gmgnAnalyze(e,{address:ADDRESS,period:'30d'});assert.equal(missing.reports[0].realized_profit,null);assert.equal(missing.reports[0].realized_roi,null);
});
test('discovery deduplicates recent makers and does not label them a profit ranking',async t=>{
 clock(t);const e=env();let calls=0;t.mock.method(globalThis,'fetch',async(target,options)=>{calls++;const u=new URL(target);assert.equal(u.pathname,'/v1/user/smartmoney');assert.equal(u.searchParams.get('chain'),'sol');assert.equal(u.searchParams.get('limit'),'10');assert.equal(options.method,'GET');return envelope({list:[{maker:ADDRESS,side:'buy',maker_info:{name:'\u0000Fixture'}},{maker:ADDRESS,side:'sell'},{maker:'1'.repeat(33)},{maker:OTHER,side:'sell'}]});});
 const result=await gmgnDiscover(e);assert.equal(result.discovery.wallets.length,2);assert.equal(result.discovery.wallets[0].label,'Fixture');assert.equal(result.discovery.wallets[0].last_side,'buy');assert.match(result.discovery.note,/not a profitability ranking/);
 await gmgnDiscover(e);await getWalletResearch(e);assert.equal(calls,1);
});
test('manual activity preserves transfer types, bounded partial samples and never mixes wallets',async t=>{
 const time=clock(t),s=initialState(NOW);s.gmgn={epoch:0,watchlist:[],reports:[{id:'fixture-report',address:ADDRESS,period:'7d',at:NOW,realized_profit:25,buy_count:3,sell_count:2}],discovery:{at:null,wallets:[]},usage:{},activities:Array.from({length:20},(_,i)=>({address:OTHER,observed_at:NOW-i,activities:[]}))};const e=env(s);let calls=0;
 t.mock.method(globalThis,'fetch',async(target)=>{calls++;const u=new URL(target);assert.equal(u.pathname,'/v1/user/wallet_activity');assert.equal(u.searchParams.get('wallet_address'),ADDRESS);assert.equal(u.searchParams.get('limit'),'10');return envelope({activities:[{event_type:'buy',timestamp:time.now()/1000-20,token:{address:OTHER,symbol:'TEST'},token_amount:'2',cost_usd:'10',price_usd:'5',tx_hash:'3'.repeat(88),provider_secret:FIXTURE_KEY},{event_type:'transferIn',timestamp:time.now()/1000-10,token:{address:OTHER},token_amount:'1'},{event_type:'sell',wallet_address:OTHER,cost_usd:'88'},{event_type:'sell',chain:'base',cost_usd:'99'}],next:'opaque-provider-cursor'});});
 const result=await gmgnActivity(e,{address:ADDRESS});const history=result.activities[0];assert.equal(history.activities.length,2);assert.equal(history.history_status,'partial');assert.equal(history.history_has_more,true);assert.equal(history.activities[0].at,time.now()-20000);assert.equal(history.activities[1].side,'transferIn');assert.equal(result.reports[0].activities.length,2);assert.equal(result.reports[0].history_status,'partial');assert.equal(e.DB.state().gmgn.activities.length,20);
 assert.ok(!JSON.stringify(result).includes('opaque-provider-cursor'));assert.ok(!JSON.stringify(result).includes(FIXTURE_KEY));assert.ok(!JSON.stringify(result).includes('provider_secret'));
 await gmgnActivity(e,{address:ADDRESS});assert.equal(calls,1);
});
test('encrypted setup verifies before saving; failed replacement keeps existing verified connection',async t=>{
 const time=clock(t),e=env(undefined,{GMGN_API_KEY:undefined});t.mock.method(globalThis,'fetch',async()=>{assert.equal(e.DB.state().gmgn_connection,undefined);return discovery();});
 const first=await gmgnConnection(e,{action:'connect',api_key:FIXTURE_KEY});assert.equal(first.connection.status,'connected');assert.equal(first.connection.source,'setup');assert.equal(first.connection.verified_at,NOW);
 const saved=e.DB.state().gmgn_connection;assert.ok(saved.ciphertext);assert.ok(!JSON.stringify(e.DB.state()).includes(FIXTURE_KEY));assert.ok(!JSON.stringify(first).includes('ciphertext'));assert.ok(!JSON.stringify(first).includes(ENCRYPTION));
 const key=await crypto.subtle.importKey('raw',Buffer.from(ENCRYPTION,'base64'),'AES-GCM',false,['decrypt']);const opts={name:'AES-GCM',iv:Buffer.from(saved.iv,'base64'),additionalData:new TextEncoder().encode('dots-ledger-gmgn-connection-v1')};
 assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt(opts,key,Buffer.from(saved.ciphertext,'base64'))),FIXTURE_KEY);
 await assert.rejects(crypto.subtle.decrypt({...opts,additionalData:new TextEncoder().encode('dots-ledger-ai-connection-v1')},key,Buffer.from(saved.ciphertext,'base64')));
 time.advance(10001);t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized '+FIXTURE_KEY,{status:401}));
 await assert.rejects(gmgnConnection(e,{action:'connect',api_key:'different-fixture-GMGN-key-12345'}),/existing connection was kept/);
 assert.deepEqual(e.DB.state().gmgn_connection,saved);assert.equal((await getWalletResearch(e)).connection.status,'connected');
});
test('disconnect blocks hosting fallback until explicit reconnect and invalid encryption fails closed',async t=>{
 const time=clock(t),e=env();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return discovery();});
 await gmgnConnection(e,{action:'test'});await gmgnConnection(e,{action:'disconnect'});assert.equal((await getWalletResearch(e)).connection.configured,false);
 await assert.rejects(gmgnDiscover(e),/Connect a GMGN/);assert.equal(calls,1);time.advance(10001);
 await gmgnConnection(e,{action:'connect'});assert.equal((await getWalletResearch(e)).connection.source,'hosting');assert.equal(calls,2);
 const bad=env(undefined,{GMGN_API_KEY:undefined,RESEARCH_ENCRYPTION_KEY:'invalid'});assert.equal(gmgnSummary(initialState(),bad).secure_setup_ready,false);await assert.rejects(gmgnConnection(bad,{action:'connect',api_key:FIXTURE_KEY}),/Secure API setup/);assert.equal(calls,2);
});
test('persistent provider cooldown and daily request budget prevent retries and quota loops',async t=>{
 const time=clock(t),e=env();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({code:429,error:'RATE_LIMIT_EXCEEDED',message:FIXTURE_KEY}),{status:429,headers:{'Retry-After':'120','X-RateLimit-Reset':String(time.now()/1000+180)}});});
 await assert.rejects(gmgnConnection(e,{action:'test'}),error=>error.gmgn_code==='rate_limited'&&!error.message.includes(FIXTURE_KEY));
 const data=await getWalletResearch(e);assert.equal(data.connection.status,'rate_limited');assert.equal(data.limits.cooldown_until,time.now()+180000);assert.equal(data.limits.requests_today,1);
 await assert.rejects(gmgnConnection(e,{action:'test'}),error=>error.gmgn_code==='rate_limited'&&error.retry_at===NOW+180000);assert.equal(calls,1);
 time.advance(180001);t.mock.method(globalThis,'fetch',async()=>{calls++;return discovery();});await gmgnConnection(e,{action:'test'});assert.equal(calls,2);
 const state=e.DB.state();state.gmgn.usage['2026-10-08']=100;state.gmgn.next_request_at=0;const capped=env(state);await assert.rejects(gmgnConnection(capped,{action:'test'}),/Daily GMGN/);assert.equal(calls,2);
 time.advance(86400000);await gmgnConnection(capped,{action:'test'});assert.equal((await getWalletResearch(capped)).limits.requests_today,1);
});
test('one CAS lease permits one concurrent provider request; disconnect discards in-flight results',async t=>{
 clock(t);const e=env();let calls=0,release;const waiting=new Promise(r=>release=r);t.mock.method(globalThis,'fetch',async()=>{calls++;await waiting;return discovery();});
 const first=gmgnConnection(e,{action:'test'});while(calls===0)await new Promise(r=>setImmediate(r));
 await assert.rejects(gmgnConnection(e,{action:'test'}),/already running/);assert.equal(calls,1);
 await gmgnConnection(e,{action:'disconnect'});release();await assert.rejects(first,/changed/);
 const data=await getWalletResearch(e);assert.equal(data.connection.configured,false);assert.equal(data.discovery.at,null);assert.equal(data.limits.busy,false);assert.equal(e.DB.state().gmgn.usage['2026-10-08'],1);
});
test('response body bound, nonfinite metrics and unsupported envelopes fail without leaking provider errors',async t=>{
 const time=clock(t),e=env();t.mock.method(globalThis,'fetch',async()=>new Response('x'.repeat(1024*1024+1)));
 await assert.rejects(gmgnConnection(e,{action:'test'}),/unsupported response/);assert.equal(e.DB.state().gmgn.lease,null);time.advance(10001);
 t.mock.method(globalThis,'fetch',async()=>envelope({list:[{wallet_address:ADDRESS,realized_profit:'Infinity',buy:'4',sell:'NaN',total_profit:'888'}]}));
 const data=await gmgnAnalyze(e,{address:ADDRESS});assert.equal(data.reports[0].realized_profit,null);assert.equal(data.reports[0].buy_count,4);assert.equal(data.reports[0].sell_count,null);time.advance(10001);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({code:99,message:FIXTURE_KEY,error:ENCRYPTION})));
 await assert.rejects(gmgnConnection(e,{action:'test'}),error=>/rejected/.test(error.message)&&!error.message.includes(FIXTURE_KEY)&&!error.message.includes(ENCRYPTION));
});
test('explicit mismatched response periods and chains are not attributed to requested wallet',async t=>{
 const time=clock(t),e=env();
 t.mock.method(globalThis,'fetch',async()=>envelope({list:[{wallet_address:ADDRESS,period:'30d',realized_profit:'25',buy:3,sell:2}]}));
 await assert.rejects(gmgnAnalyze(e,{address:ADDRESS,period:'7d'}),/unsupported response/);assert.equal((await getWalletResearch(e)).reports.length,0);
 time.advance(10001);t.mock.method(globalThis,'fetch',async()=>envelope({list:[{wallet_address:ADDRESS,chain:'base',realized_profit:'25',buy:3,sell:2}]}));
 await assert.rejects(gmgnAnalyze(e,{address:ADDRESS,period:'7d'}),/unsupported response/);assert.equal((await getWalletResearch(e)).reports.length,0);
 time.advance(10001);t.mock.method(globalThis,'fetch',async()=>envelope({list:[{maker:ADDRESS,chain:'base'},{maker:OTHER,chain:'sol'}]}));
 assert.deepEqual((await gmgnDiscover(e)).discovery.wallets.map(w=>w.address),[OTHER]);
});
