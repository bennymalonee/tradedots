import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeApi} from '../worker/api.mjs';
import {initialState} from '../worker/paper.mjs';
import {makeAdapter} from './database.mjs';
import {createHandler} from './http.mjs';
import {updateResearchTrials} from '../worker/research-trials.mjs';
import {agentSkillSnapshot,updateAgentSkills} from '../worker/agent-skill.mjs';
import {researchEvidence} from '../worker/research.mjs';

const labOrigin='https://dots.example';
const labEpoch=Date.parse('2026-10-08T10:00:00Z');
const labSession='a'.repeat(64);
const labRoles=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
function labQuote(at,price=100){return{id:'TEST',symbol:'TEST',venue:'Alpaca',asset_class:'stocks',price,bid:price*.999,ask:price*1.001,quote_at:new Date(at).toISOString(),fetched_at:new Date(at).toISOString()};}
function labFixture(){
 const state=initialState(labEpoch);state.markets=[labQuote(labEpoch)];state.sources=[{key:'stocks',status:'connected',markets:state.markets}];
 state.positions=[{market_id:'Alpaca:TEST',symbol:'TEST',asset_class:'stocks',quantity:1,cost_cents:10000,opened_at:labEpoch-60000,entry_price:100}];
 state.ledger=[{id:'existing-main-fill',at:labEpoch-60000,side:'buy',symbol:'TEST',fee:.1}];
 state.broker={status:'fixture',positions:[{symbol:'OTHER',qty:1}],orders:[]};state.broker_requests={existing:{status:'filled'}};
 let row={version:0,payload:JSON.stringify(state)};
 const pool={async query(sql,args=[]){
  if(sql.startsWith('SELECT token_hash FROM owner_sessions'))return{rows:[{token_hash:'fixture'}],rowCount:1};
  if(sql.startsWith('SELECT version,payload FROM desk_state'))return{rows:[{...row}],rowCount:1};
  if(sql.startsWith('UPDATE desk_state')){if(row.version!==args[1])return{rowCount:0};row={version:row.version+1,payload:args[0]};return{rowCount:1};}
  throw Error('Unexpected fixture SQL');
 }};
 const env={DB:makeAdapter(pool),OPENAI_API_KEY:'fixture-ai-provider-key-never-send',OPENAI_RESEARCH_MODEL:'fixture-model',GMGN_API_KEY:'fixture-gmgn-provider-key-never-send'};
 const handler=createHandler({pool,env,origin:labOrigin,worker:{fetch:request=>routeApi(request,env)}});
 return{env,handler,state:()=>JSON.parse(row.payload),write(operation){const s=JSON.parse(row.payload);operation(s);row={version:row.version+1,payload:JSON.stringify(s)};}};
}
function labRequest(path,{method='POST',input={},headers={}}={}){return new Request(labOrigin+path,{method,headers:{'Content-Type':'application/json',...headers},body:['GET','HEAD'].includes(method)?undefined:JSON.stringify(input)});}
function labOwner(path,input={}){return labRequest(path,{input,headers:{Origin:labOrigin,'oai-authenticated-user-id':'owner'}});}
function labFinancial(state){return Object.fromEntries(['cash_cents','initial_cents','positions','ledger','config','broker','broker_requests'].map(key=>[key,state[key]]));}
async function labNoProvider(operation){const previous=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('Provider request forbidden');};try{await operation();assert.equal(calls,0);}finally{globalThis.fetch=previous;}}

test('Agent lab controls require identity and same-origin owner requests before state changes or provider calls',async()=>{
 const f=labFixture(),before=f.state();
 await labNoProvider(async()=>{
  for(const headers of [{Origin:labOrigin},{Origin:'https://attacker.example','oai-authenticated-user-id':'owner'},{Origin:labOrigin,'sec-fetch-site':'cross-site','oai-authenticated-user-id':'owner'}]){
   const r=await routeApi(labRequest('/api/agent-lab/control',{input:{action:'start'},headers}),f.env);assert.equal(r.status,403);
  }
  const missingOrigin=await f.handler(labRequest('/api/agent-lab/control',{input:{action:'start'},headers:{Cookie:'__Host-dots_session='+labSession}}));assert.equal(missingOrigin.status,403);
 });assert.deepEqual(f.state(),before);
});

test('Agent lab rejects unsupported control methods and invalid actions without touching providers or main accounts',async()=>{
 const f=labFixture(),before=f.state();
 await labNoProvider(async()=>{
  const get=await routeApi(labRequest('/api/agent-lab/control',{method:'GET',headers:{'oai-authenticated-user-id':'owner'}}),f.env);assert.equal(get.status,405);
  const writeRead=await routeApi(labOwner('/api/agent-lab',{}),f.env);assert.equal(writeRead.status,405);
  const invalid=await routeApi(labOwner('/api/agent-lab/control',{action:'trade'}),f.env);assert.equal(invalid.status,400);
 });assert.deepEqual(labFinancial(f.state()),labFinancial(before));
});

test('Agent lab cached desk data is provider-free and does not expose credentials or internal storage',async()=>{
 const f=labFixture();f.write(s=>{s.gmgn_connection={ciphertext:'fixture-private-encrypted-key',iv:'fixture-private-iv'};s.private_lab_note='fixture-internal-state';});
 const before=f.state();
 await labNoProvider(async()=>{
  for(const path of ['/api/desk','/api/agent-lab','/api/export']){
   const r=await routeApi(labRequest(path,{method:'GET'}),f.env);assert.equal(r.status,200);const body=await r.text(),value=JSON.parse(body),lab=path==='/api/agent-lab'?value:value.agent_lab;
   assert.ok(lab);assert.equal(lab.skills.roles.length,6);assert.equal(lab.specialists.length,2);
   for(const secret of ['fixture-ai-provider-key-never-send','fixture-gmgn-provider-key-never-send','fixture-private-encrypted-key','fixture-private-iv','fixture-internal-state'])assert.ok(!body.includes(secret));
  }
 });assert.deepEqual(f.state(),before);
});

function labPastSkills(){
 const rows=[];
 for(let i=0;i<20;i++)for(const [roleIndex,agent]of labRoles.entries()){
  const issued=labEpoch-7200000-i*60000,finished=issued+6000,due=issued+3600000;
  rows.push({id:`past:${i}:${agent}`,report_id:`past-${i}`,agent,model:'fixture-model',policy_version:'agent-skill-v1',symbol:'TEST',market_id:'Alpaca:TEST',issued_at:issued,finished_at:finished,due_at:due,quote_at:issued,reference_price:100,stance:'bullish',probability_up:[.9,.65,.55,.2,.7,.75][roleIndex],status:'evaluated',outcome:{at:due+1000,actual:'up'}});
 }
 rows.push({id:'past-pending:ATLAS',report_id:'past-pending',agent:'ATLAS',model:'fixture-model',policy_version:'agent-skill-v1',symbol:'TEST',market_id:'Alpaca:TEST',issued_at:labEpoch-3599000,finished_at:labEpoch-3593000,due_at:labEpoch+1000,quote_at:labEpoch-3599000,reference_price:100,stance:'bullish',probability_up:.99,status:'pending',outcome:null});
 return{version:1,records:rows,retired_before:0,last_run:null};
}
function labAIReply(index){return{stance:'bullish',summary:'Fixture evidence review',challenge:'Limited observed market evidence',evidence_ids:['quote:0'],probability_up:.75+index*.02,forecast_symbol:'TEST',missing:[]};}

test('completed six-call research freezes model and past skill weights, then creates delayed isolated paper pairs',async()=>{
 const f=labFixture();f.write(s=>{s.agent_skills=labPastSkills();});
 const financial=labFinancial(f.state()),originalFetch=globalThis.fetch,originalNow=Date.now;
 let clock=labEpoch,calls=0,frozen;
 Date.now=()=>clock;
 globalThis.fetch=async(target,options)=>{
  assert.equal(String(target),'https://api.openai.com/v1/chat/completions');assert.equal(options.method,'POST');
  const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content),current=f.state().research.reports.find(r=>r.id==='integrated-round');
  assert.equal(current.status,'running');assert.equal(current.model,'fixture-model');assert.equal(current.agent_policy_version,'agent-skill-v1');
  assert.equal(body.model,current.model);
  assert.deepEqual(current.forecast_snapshot.weights,frozen.weights);assert.deepEqual(current.forecast_snapshot.scored_counts,frozen.scored_counts);
  assert.deepEqual(payload.evidence.ai_agent_skills.snapshot.weights,frozen.weights);
  assert.ok(!f.state().agent_skills.records.some(r=>r.report_id==='integrated-round'));
  assert.equal(f.state().research_trials.probes.length,0);
  const index=calls++;clock+=1000;
  if(index===0)f.write(s=>{s.markets=[labQuote(clock,105)];updateAgentSkills(s,clock);});
  return Response.json({choices:[{message:{content:JSON.stringify(labAIReply(index))}}],usage:{total_tokens:10}});
 };
 try{
  const start=await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),f.env);assert.equal(start.status,200);
  assert.equal(f.state().research_trials.probes.length,0);
  frozen=agentSkillSnapshot(f.state(),'fixture-model',clock);assert.equal(frozen.adaptive,true);
  const response=await routeApi(labOwner('/api/research/run',{intent_id:'integrated-round'}),f.env);assert.equal(response.status,200);
  const report=await response.json();assert.equal(report.status,'completed');assert.equal(calls,6);
  assert.deepEqual(report.forecast_snapshot.weights,frozen.weights);
  assert.notDeepEqual(agentSkillSnapshot(f.state(),'fixture-model',clock).scored_counts,frozen.scored_counts);
  const state=f.state(),registered=state.agent_skills.records.filter(r=>r.report_id===report.id);
  assert.equal(registered.length,6);assert.deepEqual(registered.map(r=>r.agent).sort(),[...labRoles].sort());
  assert.ok(registered.every(r=>r.model==='fixture-model'&&r.policy_version==='agent-skill-v1'&&r.status==='pending'));
  assert.equal(state.research_trials.probes.length,1);const eligible=report.finished_at+15000;
  assert.equal(state.research_trials.probes[0].status,'waiting');
  clock=eligible-1;f.write(s=>{s.markets=[labQuote(clock,110)];updateResearchTrials(s,clock);});
  assert.equal(f.state().research_trials.probes[0].status,'waiting');
  clock=eligible;f.write(s=>{s.markets=[labQuote(eligible-1,110)];updateResearchTrials(s,clock);});
  assert.equal(f.state().research_trials.probes[0].status,'waiting','old source book must not enter');
  f.write(s=>{s.markets=[labQuote(clock,110)];updateResearchTrials(s,clock);});
  const open=f.state().research_trials.probes[0];assert.equal(open.status,'open');assert.equal(open.entry.at,eligible);
  assert.ok(open.entry.fee>0);assert.ok(open.entry.price>open.entry.ask);
  clock=open.exit_due_at;f.write(s=>{s.markets=[labQuote(clock-1,120)];updateResearchTrials(s,clock);});
  assert.equal(f.state().research_trials.probes[0].status,'open','old exit book must remain unresolved');
  clock+=60000;f.write(s=>{s.markets=[labQuote(clock,120)];updateResearchTrials(s,clock);});
  const closed=f.state().research_trials.probes[0];assert.equal(closed.status,'closed');assert.ok(closed.exit.held_seconds>3600);
  assert.equal(closed.policy_net_pnl,closed.benchmark_net_pnl);assert.equal(closed.paired_net_advantage,0);
  assert.ok(closed.benchmark_net_pnl<closed.benchmark_gross_pnl);
  assert.equal(calls,6);assert.deepEqual(labFinancial(f.state()),financial);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('research without an experiment records role forecasts but cannot backfill old reports into a later experiment',async()=>{
 const f=labFixture(),originalFetch=globalThis.fetch,originalNow=Date.now;let clock=labEpoch,calls=0;
 Date.now=()=>clock;globalThis.fetch=async()=>{const index=calls++;clock+=1000;return Response.json({choices:[{message:{content:JSON.stringify(labAIReply(index))}}]});};
 try{
  const r=await routeApi(labOwner('/api/research/run',{intent_id:'before-experiment'}),f.env);assert.equal((await r.json()).status,'completed');
  assert.equal(f.state().agent_skills.records.length,6);assert.equal(f.state().research_trials,undefined);
  clock+=1000;const start=await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),f.env);assert.equal(start.status,200);
  assert.equal(f.state().research_trials.probes.length,0);assert.equal(calls,6);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('failed and preview research, and missing AI credentials, cannot register forecasts or paper entries',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let clock=labEpoch,calls=0;
 Date.now=()=>clock;
 try{
  const missing=labFixture();delete missing.env.OPENAI_API_KEY;
  await labNoProvider(async()=>{await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),missing.env);const r=await routeApi(labOwner('/api/research/run',{intent_id:'missing-key'}),missing.env);assert.equal((await r.json()).status,'needs_connection');});
  assert.equal(missing.state().agent_skills,undefined);assert.equal(missing.state().research_trials.probes.length,0);
  const preview=labFixture();await labNoProvider(async()=>{await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),preview.env);const r=await routeApi(labOwner('/api/research/preview',{intent_id:'preview-only'}),preview.env);assert.equal((await r.json()).status,'preview');});
  assert.equal(preview.state().agent_skills,undefined);assert.equal(preview.state().research_trials.probes.length,0);
  const failed=labFixture(),financial=labFinancial(failed.state());
  await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),failed.env);
  globalThis.fetch=async()=>{const index=calls++;clock+=1000;return index===2?Response.json({error:'fixture failure'},{status:500}):Response.json({choices:[{message:{content:JSON.stringify(labAIReply(index))}}]});};
  const result=await routeApi(labOwner('/api/research/run',{intent_id:'failed-round'}),failed.env);assert.equal((await result.json()).status,'failed');
  assert.equal(calls,3);assert.equal(failed.state().agent_skills,undefined);assert.equal(failed.state().research_trials.probes.length,0);
  assert.deepEqual(labFinancial(failed.state()),financial);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('revocation during the sixth AI request fails the final round before registering learning or paper probes',async()=>{
 const f=labFixture(),originalFetch=globalThis.fetch,originalNow=Date.now,financial=labFinancial(f.state());let clock=labEpoch,calls=0;
 Date.now=()=>clock;
 globalThis.fetch=async()=>{
  const index=calls++;clock+=1000;
  if(index===5)f.write(s=>{s.research.connection_epoch=(s.research.connection_epoch||0)+1;});
  return Response.json({choices:[{message:{content:JSON.stringify(labAIReply(index))}}]});
 };
 try{
  assert.equal((await routeApi(labOwner('/api/agent-lab/control',{action:'start'}),f.env)).status,200);
  const response=await routeApi(labOwner('/api/research/run',{intent_id:'revoked-final-request'}),f.env),report=await response.json();
  assert.equal(calls,6);assert.equal(report.status,'failed');assert.equal(report.probability_up,null);
  assert.match(report.error,/connection changed/i);assert.equal(f.state().research.reports[0].status,'failed');
  assert.equal(f.state().agent_skills,undefined);assert.equal(f.state().research_trials.probes.length,0);
  assert.deepEqual(labFinancial(f.state()),financial);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('AI paper outcome context excludes future, same-time, different-symbol and unresolved probes',()=>{
 const s=initialState(labEpoch);s.markets=[labQuote(labEpoch)];
 s.research_trials={policy_version:'research-shadow-v1',enabled:false,probes:[
  {id:'past-one',symbol:'TEST',status:'closed',closed_at:labEpoch-2000,policy_net_pnl:2,paired_net_advantage:1},
  {id:'past-two',symbol:'TEST',status:'closed',closed_at:labEpoch-1000,policy_net_pnl:-1,paired_net_advantage:-.5},
  {id:'future',symbol:'TEST',status:'closed',closed_at:labEpoch+1,policy_net_pnl:1000,paired_net_advantage:1000},
  {id:'same-time',symbol:'TEST',status:'closed',closed_at:labEpoch,policy_net_pnl:2000,paired_net_advantage:2000},
  {id:'other-market',symbol:'OTHER',status:'closed',closed_at:labEpoch-1000,policy_net_pnl:3000,paired_net_advantage:3000},
  {id:'unresolved',symbol:'TEST',status:'open',closed_at:labEpoch-1000,policy_net_pnl:4000,paired_net_advantage:4000},
  {id:'invalid-result',symbol:'TEST',status:'closed',closed_at:labEpoch-1000,policy_net_pnl:null,paired_net_advantage:5000}
 ]};
 const result=researchEvidence(s,labEpoch,'fixture-model').ai_paper_outcomes;
 assert.equal(result.symbol,'TEST');assert.equal(result.closed_pairs,2);assert.equal(result.mean_policy_net,.5);assert.equal(result.paired_net_advantage,.5);
});
