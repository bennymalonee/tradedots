import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeApi,observeMonitoring,refreshMonitoring} from '../worker/api.mjs';
import {initialState} from '../worker/paper.mjs';
import {makeAdapter} from './database.mjs';
import {recordMonitoringSuccess,configureMonitoringScheduler,recordSchedulerHeartbeat} from '../worker/monitoring.mjs';
import {researchSummary,runResearch,validateResearchReply} from '../worker/research.mjs';
import {researchTrialsControl} from '../worker/research-trials.mjs';

const readyEpoch=Date.parse('2026-10-09T14:00:00Z'),readyOrigin='https://dots.example';
function readyQuote(at=readyEpoch,symbol='TEST',price=100){return{id:symbol,symbol,venue:'Alpaca',asset_class:'stocks',price,bid:price*.999,ask:price*1.001,quote_at:new Date(at).toISOString(),collected_at:new Date(at).toISOString(),fetched_at:new Date(at-100).toISOString()};}
function readyFixture(){
 const state=initialState(readyEpoch);state.running=true;state.markets=[readyQuote()];state.sources=[{key:'stocks',status:'connected',markets:state.markets}];
 state.observations=Array.from({length:12},(_,i)=>{const at=readyEpoch-(11-i)*60000;return{...readyQuote(at),at,market_id:'Alpaca:TEST'};});
 recordMonitoringSuccess(state,{actor:'browser',quotes:1},readyEpoch-60000);recordMonitoringSuccess(state,{actor:'browser',quotes:1},readyEpoch);
 let row={version:0,payload:JSON.stringify(state)};
 const pool={async query(sql,args=[]){
  if(sql.startsWith('SELECT version,payload FROM desk_state'))return{rows:[{...row}],rowCount:1};
  if(sql.startsWith('UPDATE desk_state')){if(row.version!==args[1])return{rowCount:0};row={version:row.version+1,payload:args[0]};return{rowCount:1};}
  throw Error('Unexpected fixture SQL');
 }};
 const env={DB:makeAdapter(pool),OPENAI_API_KEY:'fixture-openai-key-never-expose',OPENAI_RESEARCH_MODEL:'fixture-model',GMGN_API_KEY:'fixture-gmgn-key-never-expose'};
 return{env,state:()=>JSON.parse(row.payload),write(operation){const next=JSON.parse(row.payload);operation(next);row={version:row.version+1,payload:JSON.stringify(next)};}};
}
function readyRequest(path,{method='GET',input={},headers={}}={}){return new Request(readyOrigin+path,{method,headers:{'Content-Type':'application/json',...headers},body:method==='GET'?undefined:JSON.stringify(input)});}
function readyOwner(path,input){return readyRequest(path,{method:'POST',input,headers:{Origin:readyOrigin,'oai-authenticated-user-id':'owner'}});}
async function readyNoProvider(operation){const savedFetch=globalThis.fetch,savedNow=Date.now;let calls=0;Date.now=()=>readyEpoch;globalThis.fetch=()=>{calls++;throw Error('Provider call forbidden');};try{await operation();assert.equal(calls,0);}finally{globalThis.fetch=savedFetch;Date.now=savedNow;}}

test('guided testing readiness is cached, provider-free and strips connection and scheduler credentials',async()=>{
 const f=readyFixture();f.write(s=>{s.research_connection={ciphertext:'fixture-secret-cipher',iv:'fixture-secret-iv'};s.monitoring.scheduler.owner_id='fixture-secret-owner';s.private_readiness_note='fixture-private-note';});
 const before=f.state();
 await readyNoProvider(async()=>{
  for(const path of ['/api/testing-readiness','/api/desk']){
   const response=await routeApi(readyRequest(path),f.env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
   const text=await response.text(),body=JSON.parse(text),readiness=path==='/api/testing-readiness'?body:body.testing_readiness;
   assert.ok(readiness);assert.ok(Array.isArray(readiness.steps));assert.ok(readiness.steps.length>=4);assert.ok(readiness.monitoring);
   assert.equal(readiness.provider_calls,0);assert.equal(readiness.orders_submitted,0);
   for(const secret of ['fixture-openai-key-never-expose','fixture-gmgn-key-never-expose','fixture-secret-cipher','fixture-secret-iv','fixture-secret-owner','fixture-private-note'])assert.ok(!text.includes(secret),path+' leaked '+secret);
  }
 });assert.deepEqual(f.state(),before,'cached checks must not modify observations or account state');
});

test('testing readiness rejects write methods and points missing AI setup toward secure setup without making calls',async()=>{
 const f=readyFixture();delete f.env.OPENAI_API_KEY;
 await readyNoProvider(async()=>{
  assert.equal((await routeApi(readyOwner('/api/testing-readiness',{}),f.env)).status,405);
  const body=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();
  assert.notEqual(body.status,'ready');assert.ok(body.steps.some(step=>step.status!=='pass'&&step.action?.kind==='api_setup'));
 });
});

test('stale quotes and insufficient distinct history prevent paid research before reserving rounds',async()=>{
 for(const change of [s=>{s.markets=[readyQuote(readyEpoch-90001)];},s=>{s.observations=s.observations.slice(-2);}]){
  const f=readyFixture();f.write(change);const before=f.state();
  await readyNoProvider(async()=>{
   const result=await routeApi(readyOwner('/api/research/run',{intent_id:'blocked-'+(before.observations.length)}),f.env),body=await result.json();
   assert.notEqual(body.status,'completed');assert.notEqual(body.status,'failed');assert.ok(body.status.startsWith('waiting_'),JSON.stringify(body));
  });
  const after=f.state();assert.ok(!after.research?.usage||Object.values(after.research.usage).every(value=>value.calls_reserved===0));
  assert.equal(after.agent_skills,undefined);assert.equal(after.research_trials,undefined);assert.deepEqual(after.observations,before.observations);
 }
});

test('scheduled paper research requires a current continuous monitor before spending API rounds',async()=>{
 for(const mode of ['browser','browser_no_lab','disabled','stalled','slow']){
  const f=readyFixture();f.write(s=>{s.research={enabled:true,max_rounds_daily:2,reports:[],usage:{},lease:null,last_started:0};if(mode!=='browser_no_lab')researchTrialsControl(s,{action:'start'},readyEpoch-1000);});
  if(!mode.startsWith('browser'))Object.assign(f.env,{MONITOR_RUNTIME:'vps',MONITOR_ENABLED:mode==='disabled'?'false':'true',MONITOR_INTERVAL_SECONDS:mode==='slow'?'600':'60'});
  f.write(s=>{const at=mode==='stalled'?readyEpoch-300000:readyEpoch;configureMonitoringScheduler(s,{enabled:true,interval_seconds:60},at);recordSchedulerHeartbeat(s,{owner_id:'fixture-owner'},at);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},at-60000);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},at);});
  await readyNoProvider(async()=>{const result=await runResearch(f.env,{},true);assert.ok(result.skip||result.status.startsWith('waiting_'),result.status+' for '+mode);assert.notEqual(result.status,'completed');});
  assert.ok(!Object.values(f.state().research.usage).some(usage=>usage.calls_reserved>0));
 }
});

test('research target and daily cap controls require owner access, reject invalid settings and do not call providers',async()=>{
 const f=readyFixture();f.write(s=>{s.markets.push(readyQuote(readyEpoch,'OTHER'));});const before=f.state();
 await readyNoProvider(async()=>{
  for(const headers of [{Origin:readyOrigin},{Origin:'https://attacker.example','oai-authenticated-user-id':'owner'},{Origin:readyOrigin,'oai-authenticated-user-id':'owner','sec-fetch-site':'cross-site'}]){
   const response=await routeApi(readyRequest('/api/research/control',{method:'POST',input:{enabled:false,max_rounds_daily:2,target_symbol:'OTHER'},headers}),f.env);assert.equal(response.status,403);
  }
  for(const input of [{enabled:false,max_rounds_daily:0,target_symbol:'TEST'},{enabled:false,max_rounds_daily:5,target_symbol:'TEST'},{enabled:false,max_rounds_daily:2,target_symbol:'MISSING'},{enabled:false,max_rounds_daily:2,target_symbol:['TEST']}]){
   const response=await routeApi(readyOwner('/api/research/control',input),f.env);assert.equal(response.status,400,JSON.stringify(input));
  }
  assert.deepEqual(f.state(),before,'invalid controls must not change state');
  const response=await routeApi(readyOwner('/api/research/control',{enabled:false,max_rounds_daily:1,target_symbol:'OTHER'}),f.env);assert.equal(response.status,200);
  assert.equal(f.state().research.target_symbol,'OTHER');assert.equal(f.state().research.max_rounds_daily,1);assert.equal(f.state().research.enabled,false);
  const readiness=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();assert.equal(readiness.selected_symbol,'OTHER');
  assert.ok(readiness.steps.some(step=>step.id==='history'&&step.status!=='pass'),'history must follow selected target, not the first market');
 });
 for(const key of ['cash_cents','positions','ledger','config'])assert.deepEqual(f.state()[key],before[key]);
});

test('research aggregates show only completed current model, policy and prompt outcomes observed before now',()=>{
 const f=readyFixture(),state=f.state(),past=readyEpoch-7200000;
 const current={id:'current',mode:'ai',status:'completed',at:past,finished_at:past+6000,due_at:past+3600000,model:'fixture-model',agent_policy_version:'agent-skill-v2',prompt_version:'research-context-v2',forecast_policy_version:'net-return-v1',symbol:'TEST',agents:[],outcome:{status:'evaluated',at:readyEpoch-1000,brier:.16}};
 state.research={enabled:false,max_rounds_daily:2,reports:[current,
  {...current,id:'legacy',agent_policy_version:'agent-skill-v1',prompt_version:undefined,outcome:{status:'evaluated',at:readyEpoch-1000,brier:0}},
  {...current,id:'other-model',model:'other-model',outcome:{status:'evaluated',at:readyEpoch-1000,brier:0}},
  {...current,id:'old-prompt',prompt_version:'research-context-v1',outcome:{status:'evaluated',at:readyEpoch-1000,brier:0}},
  {...current,id:'preview',mode:'preview',outcome:{status:'evaluated',at:readyEpoch-1000,brier:0}},
  {...current,id:'failed',status:'failed',outcome:{status:'evaluated',at:readyEpoch-1000,brier:0}},
  {...current,id:'future',outcome:{status:'evaluated',at:readyEpoch+1,brier:0}}
 ],usage:{},lease:null,last_started:0};
 const savedNow=Date.now;Date.now=()=>readyEpoch;
 try{const summary=researchSummary(state,f.env);assert.equal(summary.evaluated,1);assert.equal(summary.mean_brier,.16);assert.equal(summary.model,'fixture-model');assert.equal(summary.agent_policy_version,'agent-skill-v2');assert.equal(summary.prompt_version,'research-context-v2');}finally{Date.now=savedNow;}
});


test('two real minute scheduler collections permit exactly one capped six-call prospective round',async()=>{
 const f=readyFixture();Object.assign(f.env,{MONITOR_RUNTIME:'vps',MONITOR_ENABLED:'true',MONITOR_INTERVAL_SECONDS:'60'});
 f.write(s=>{s.research={enabled:true,max_rounds_daily:1,reports:[],usage:{},lease:null,last_started:0};researchTrialsControl(s,{action:'start'},readyEpoch-1000);configureMonitoringScheduler(s,{enabled:true,interval_seconds:60},readyEpoch-60000);recordSchedulerHeartbeat(s,{owner_id:'fixture-owner'},readyEpoch);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},readyEpoch-60000);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},readyEpoch);});
 const before=f.state(),savedFetch=globalThis.fetch,savedNow=Date.now;let now=readyEpoch,calls=0;Date.now=()=>now;
 globalThis.fetch=async(target,options)=>{assert.equal(String(target),'https://api.openai.com/v1/chat/completions');assert.equal(options.method,'POST');const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.primary_symbol,'TEST');assert.ok(payload.evidence.market_evidence.history.samples.length>=12);calls++;now+=1000;return Response.json({choices:[{message:{content:JSON.stringify({stance:'bullish',summary:'Synthetic role review',challenge:'Unverified forecast',evidence_ids:['quote:0'],probability_up:.8,forecast_symbol:'TEST',expected_return_pct:2,downside_return_pct:-1,missing:[]})}}]});};
 try{const report=await runResearch(f.env,{},true);assert.equal(report.status,'completed');assert.equal(calls,6);assert.equal(f.state().research_trials.probes.length,1);assert.equal(f.state().research_trials.probes[0].status,'waiting');assert.equal(f.state().agent_skills.records.length,6);
  const usage=Object.values(f.state().research.usage);assert.equal(usage.length,1);assert.equal(usage[0].rounds,1);assert.equal(usage[0].calls_reserved,6);
  now=readyEpoch+3600001;const next=await runResearch(f.env,{},true);assert.notEqual(next.status,'completed');assert.equal(calls,6,'old data cannot spend another capped round');
  for(const key of ['cash_cents','positions','ledger','config'])assert.deepEqual(f.state()[key],before[key]);
 }finally{globalThis.fetch=savedFetch;Date.now=savedNow;}
});

test('guided readiness advances from experiment start to Research Room and returns to setup when paused',async()=>{
 const f=readyFixture(),before=f.state();
 await readyNoProvider(async()=>{
  let setup=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();assert.equal(setup.status,'needs_attention');assert.equal(setup.next_action.id,'experiment');assert.equal(setup.next_action.action.kind,'agent_lab');
  for(const action of ['start','pause','resume']){
   const response=await routeApi(readyOwner('/api/agent-lab/control',{action}),f.env);assert.equal(response.status,200);
   setup=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();
   assert.equal(setup.status,action==='pause'?'needs_attention':'ready');assert.equal(setup.next_action.action.kind,action==='pause'?'agent_lab':'research');
  }
 });for(const key of ['cash_cents','positions','ledger','config'])assert.deepEqual(f.state()[key],before[key]);
});

test('manual paper experiment research waits for measured browser cadence before paid calls',async()=>{
 const f=readyFixture();f.write(s=>{researchTrialsControl(s,{action:'start'},readyEpoch-1000);s.monitoring.browser={};});
 await readyNoProvider(async()=>{const response=await routeApi(readyOwner('/api/research/run',{intent_id:'missing-cadence'}),f.env),result=await response.json();assert.equal(result.status,'waiting_for_monitoring');});
 assert.ok(!Object.values(f.state().research?.usage||{}).some(value=>value.calls_reserved>0));assert.equal(f.state().agent_skills,undefined);assert.equal(f.state().research_trials.probes.length,0);
});


test('null forecasts and correctly scoped downside-only risk replies validate without invented direction',()=>{
 const base={stance:'neutral',summary:'Evidence does not support direction',challenge:'Missing forward certainty',evidence_ids:['quote:0'],probability_up:null,forecast_symbol:null,expected_return_pct:null,downside_return_pct:null,missing:['Uncertain direction']},allowed=new Set(['quote:0']);
 const neutral=validateResearchReply(base,allowed,'TEST');assert.equal(neutral.probability_up,null);assert.equal(neutral.expected_return_pct,null);assert.equal(neutral.downside_return_pct,null);assert.equal(neutral.forecast_symbol,null);
 const risk=validateResearchReply({...base,forecast_symbol:'TEST',downside_return_pct:-1},allowed,'TEST');assert.equal(risk.probability_up,null);assert.equal(risk.expected_return_pct,null);assert.equal(risk.downside_return_pct,-1);assert.equal(risk.forecast_symbol,'TEST');
 assert.throws(()=>validateResearchReply({...base,forecast_symbol:'OTHER',downside_return_pct:-1},allowed,'TEST'),/return forecast|wrong symbol/);
 assert.throws(()=>validateResearchReply({...base,forecast_symbol:null,downside_return_pct:-1},allowed,'TEST'),/return forecast|wrong symbol/);
});

test('monitoring never turns fetched-only Alpaca timestamps into actual source-quote history',async()=>{
 const f=readyFixture();f.write(s=>{s.observations=[];for(let index=0;index<12;index++){const at=readyEpoch-(12-index)*60000,q=readyQuote(at);delete q.quote_at;observeMonitoring(s,{markets:[q],sources:[{key:'stocks',status:'connected',markets:[q]}]},at);}s.markets=[readyQuote()];});
 await readyNoProvider(async()=>{const setup=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();assert.equal(setup.market_evidence.history.samples.length,1);assert.equal(setup.market_evidence.readiness.ready,false);assert.ok(setup.steps.some(step=>step.id==='history'&&step.status!=='pass'));});
});


test('a superseded quote collection returns skipped without starting a paid scheduled research round',async()=>{
 const f=readyFixture();Object.assign(f.env,{MONITOR_RUNTIME:'vps',MONITOR_ENABLED:'true',MONITOR_INTERVAL_SECONDS:'60',ALPACA_API_KEY:'fixture-alpaca-key',ALPACA_API_SECRET:'fixture-alpaca-secret'});
 f.write(s=>{s.last_tick=0;s.research={enabled:true,max_rounds_daily:2,reports:[],usage:{},lease:null,last_started:0};configureMonitoringScheduler(s,{enabled:true,interval_seconds:60},readyEpoch-60000);recordSchedulerHeartbeat(s,{owner_id:'fixture-owner'},readyEpoch);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},readyEpoch-60000);recordMonitoringSuccess(s,{actor:'scheduler',quotes:1},readyEpoch);});
 const savedFetch=globalThis.fetch,savedNow=Date.now;let marketCalls=0,aiCalls=0;Date.now=()=>readyEpoch;
 globalThis.fetch=async target=>{const url=String(target);if(url==='https://api.openai.com/v1/chat/completions'){aiCalls++;throw Error('Paid AI must not run after skipped collection');}marketCalls++;if(marketCalls===1)f.write(s=>{s.tick_lease={token:'superseding-collection-token',until:readyEpoch+120000};});
  if(url.includes('/v2/stocks/quotes/latest'))return Response.json({quotes:{TEST:{ap:100.1,bp:99.9,t:new Date(readyEpoch).toISOString()}}});
  if(url.includes('/crypto/us/latest/quotes'))return Response.json({quotes:{}});
  if(url.includes('dexscreener'))return Response.json({pairs:[]});
  if(url.includes('polymarket'))return Response.json([]);
  if(url.includes('kalshi'))return Response.json({markets:[]});
  throw Error('Unexpected fixture market endpoint');
 };
 try{const result=await refreshMonitoring(f.env,{actor:'scheduler'});assert.equal(result.skipped,true);assert.equal(aiCalls,0);assert.equal(marketCalls,5);assert.equal(f.state().research.reports.length,0);assert.deepEqual(f.state().research.usage,{});assert.equal(f.state().tick_lease.token,'superseding-collection-token');}finally{globalThis.fetch=savedFetch;Date.now=savedNow;}
});


test('a frozen different-model experiment blocks new AI spending and resume but may be paused and replaced',async()=>{
 const f=readyFixture();f.write(s=>{researchTrialsControl(s,{action:'start'},readyEpoch-1000);s.research_trials.cohort={model:'previous-model',agent_policy_version:'agent-skill-v2',prompt_version:'research-context-v2',forecast_policy_version:'net-return-v1'};});
 const before=f.state();
 await readyNoProvider(async()=>{
  let setup=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();assert.equal(setup.status,'blocked');assert.equal(setup.steps.find(step=>step.id==='experiment').status,'blocked');
  const report=await(await routeApi(readyOwner('/api/research/run',{intent_id:'incompatible-cohort'}),f.env)).json();assert.equal(report.status,'waiting_for_experiment');assert.ok(!Object.values(f.state().research?.usage||{}).some(value=>value.calls_reserved>0));
  assert.equal((await routeApi(readyOwner('/api/agent-lab/control',{action:'resume'}),f.env)).status,400);
  assert.equal((await routeApi(readyOwner('/api/agent-lab/control',{action:'pause'}),f.env)).status,200);assert.equal(f.state().research_trials.enabled,false);
  assert.equal((await routeApi(readyOwner('/api/agent-lab/control',{action:'start'}),f.env)).status,200);assert.equal(f.state().research_trials.cohort,null);assert.equal(f.state().research_trials.archives.length,1);
  setup=await(await routeApi(readyRequest('/api/testing-readiness'),f.env)).json();assert.equal(setup.status,'ready');
 });for(const key of ['cash_cents','positions','ledger','config'])assert.deepEqual(f.state()[key],before[key]);
});
