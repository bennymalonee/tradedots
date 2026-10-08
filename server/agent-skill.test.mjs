import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerAgentForecasts,updateAgentSkills,agentSkillSummary,agentSkillSnapshot,blendAgentForecasts} from '../worker/agent-skill.mjs';

const base = Date.parse('2026-10-08T08:00:00Z');
const names = ['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
function report(id='round',at=base,model='test-model') {
  return {id,at,finished_at:at+1000,due_at:at+3600000,mode:'ai',status:'completed',model,
    agent_policy_version:'agent-skill-v1',symbol:'TEST',market_id:'Alpaca:TEST',quote_at:new Date(at).toISOString(),reference_price:100,
    agents:names.map(name=>({name,stance:'bullish',forecast_symbol:'TEST',probability_up:.8}))};
}
function book(at,price=110,extra={}) {
  return {venue:'Alpaca',id:'TEST',symbol:'TEST',asset_class:'stocks',price,quote_at:new Date(at).toISOString(),...extra};
}
function settle(state,r,price=110) {
  state.markets=[book(r.due_at,price)];
  return updateAgentSkills(state,r.due_at);
}
function close(actual,expected) {assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);}

test('only completed versioned AI reports register immutable once-per-agent forecasts',()=>{
  const state={cash_cents:100000,config:{ticket_pct:6}},r=report();
  for(const change of [{mode:'preview'},{status:'failed'},{agent_policy_version:undefined},{model:undefined},{finished_at:r.finished_at+1}]) {
    const sample={...r,...change};
    const now=change.finished_at?r.finished_at:r.finished_at;
    assert.equal(registerAgentForecasts(state,sample,now).registered,0);
    assert.equal(state.agent_skills,undefined);
  }
  assert.equal(registerAgentForecasts(state,r,r.finished_at).registered,6);
  const snapshot=JSON.stringify(state.agent_skills.records);
  const changed=structuredClone(r);changed.agents[0].probability_up=.01;changed.reference_price=999;
  assert.equal(registerAgentForecasts(state,changed,r.finished_at+1).registered,0);
  assert.equal(JSON.stringify(state.agent_skills.records),snapshot);
  assert.equal(state.cash_cents,100000);assert.deepEqual(state.config,{ticket_pct:6});
});

test('early, cached, future, stale, wrong-market and pre-horizon quotes cannot settle a forecast',()=>{
  const state={},r=report();registerAgentForecasts(state,r,r.finished_at);
  const attempts=[
    {now:r.due_at-1,q:book(r.due_at-1)},
    {now:r.due_at,q:book(r.due_at,110,{cached:true})},
    {now:r.due_at,q:book(r.due_at+1)},
    {now:r.due_at+100000,q:book(r.due_at)},
    {now:r.due_at,q:book(r.due_at,110,{id:'OTHER'})},
    {now:r.due_at,q:book(r.due_at-1)},
    {now:r.due_at,q:book(r.due_at,110,{asset_class:'prediction'})}
  ];
  for(const {now,q}of attempts){state.markets=[q];assert.equal(updateAgentSkills(state,now).evaluated,0);}
  assert.ok(state.agent_skills.records.every(row=>row.status==='pending'));
  assert.equal(settle(state,r).evaluated,6);
  assert.equal(updateAgentSkills(state,r.due_at).evaluated,0);
  const summary=agentSkillSummary(state,r.model,r.due_at);
  assert.ok(summary.roles.every(role=>role.scored===1));
  close(summary.roles[0].mean_brier,.04);
  assert.ok(state.agent_skills.records.every(row=>row.outcome.quote_at===r.due_at));
});

test('label source time must be strictly after report completion and unavailable future reports are rejected',()=>{
  const state={},r=report();r.due_at=r.finished_at;
  assert.equal(registerAgentForecasts(state,r,r.finished_at).status,'ineligible');
  r.due_at=r.finished_at+1;registerAgentForecasts(state,r,r.finished_at);
  state.markets=[book(r.finished_at,110)];
  assert.equal(updateAgentSkills(state,r.due_at).evaluated,0);
  state.markets=[book(r.due_at,110)];
  assert.equal(updateAgentSkills(state,r.due_at).evaluated,6);
});

test('abstentions with numeric probabilities never train; null, invalid, unchanged and expired labels remain distinct',()=>{
  const state={},r=report();
  r.agents[0].stance='abstain';r.agents[0].probability_up=.99;
  r.agents[1].probability_up=null;
  r.agents[2].forecast_symbol='OTHER';
  registerAgentForecasts(state,r,r.finished_at);
  assert.equal(settle(state,r,100).unchanged,3);
  let summary=agentSkillSummary(state,r.model,r.due_at);
  assert.equal(summary.roles[0].abstained,1);assert.equal(summary.roles[1].abstained,1);
  assert.equal(summary.roles[2].invalid,1);assert.equal(summary.roles[3].unchanged,1);
  assert.ok(summary.roles.every(role=>role.scored===0&&role.mean_brier===null));
  assert.equal(state.agent_skills.records[0].probability_up,.99);
  const later=report('later',base+7200000);registerAgentForecasts(state,later,later.finished_at);
  state.markets=[book(later.due_at+600001,120)];
  assert.equal(updateAgentSkills(state,later.due_at+600001).expired,6);
  summary=agentSkillSummary(state,later.model,later.due_at+600001);
  assert.ok(summary.roles.every(role=>role.expired===1&&role.scored===0));
});

test('model and policy version isolation plus as-of filtering prevent outcome leakage',()=>{
  const state={},r=report();registerAgentForecasts(state,r,r.finished_at);settle(state,r);
  assert.equal(agentSkillSummary(state,'other-model',r.due_at).records_retained,0);
  assert.ok(agentSkillSummary(state,r.model,r.finished_at).roles.every(role=>role.pending===1&&role.scored===0));
  const snapshot=agentSkillSnapshot(state,r.model,r.finished_at);
  assert.deepEqual(snapshot.scored_counts,{ATLAS:0,ORION:0,TITAN:0,NOVA:0});
  const changed=report('legacy',base+7200000);changed.agent_policy_version='different-policy';
  assert.equal(registerAgentForecasts(state,changed,changed.finished_at).registered,0);
  const newer=report('different',base+7200000,'other-model');
  registerAgentForecasts(state,newer,newer.finished_at);settle(state,newer,90);
  close(agentSkillSummary(state,r.model,newer.due_at).roles[0].mean_brier,.04);
  close(agentSkillSummary(state,'other-model',newer.due_at).roles[0].mean_brier,.64);
});

test('capacity never discards pending forecasts; retired records cannot be registered and scored again',()=>{
  const state={};
  for(let i=0;i<100;i++){const r=report('pending-'+i,base+i*10);assert.equal(registerAgentForecasts(state,r,r.finished_at).registered,6);}
  assert.equal(state.agent_skills.records.length,600);
  const before=JSON.stringify(state.agent_skills.records),blocked=report('blocked',base+2000);
  assert.equal(registerAgentForecasts(state,blocked,blocked.finished_at).status,'capacity_blocked');
  assert.equal(JSON.stringify(state.agent_skills.records),before);
  const first=report('pending-0');assert.equal(settle(state,first).evaluated,6);
  const next=report('next',first.due_at+1000);
  assert.equal(registerAgentForecasts(state,next,next.finished_at).registered,6);
  assert.equal(state.agent_skills.records.length,600);
  assert.equal(state.agent_skills.records.filter(row=>row.status==='pending').length,600);
  assert.equal(registerAgentForecasts(state,first,next.finished_at).registered,0);
  assert.ok(!state.agent_skills.records.some(row=>row.report_id===first.id));
});

test('weights stay equal until every contributor has support, then shrink loss and remain capped and normalized',()=>{
  const state={};let now=base;
  for(let i=0;i<19;i++){
    const r=report('trained-'+i,base+i*7200000);r.agents[0].probability_up=.99;
    r.agents[1].probability_up=.01;r.agents[2].probability_up=.5;r.agents[3].probability_up=.6;
    registerAgentForecasts(state,r,r.finished_at);settle(state,r);now=r.due_at;
  }
  const frozen=agentSkillSnapshot(state,'test-model',now),before=JSON.stringify(frozen);
  assert.equal(frozen.adaptive,false);assert.deepEqual(Object.values(frozen.weights),[.25,.25,.25,.25]);
  for(let i=19;i<90;i++){
    const r=report('trained-'+i,base+i*7200000);r.agents[0].probability_up=.99;
    r.agents[1].probability_up=.01;r.agents[2].probability_up=.5;r.agents[3].probability_up=.6;
    registerAgentForecasts(state,r,r.finished_at);settle(state,r);now=r.due_at;
    if(i===19)assert.equal(agentSkillSnapshot(state,'test-model',now).adaptive,true);
  }
  const learned=agentSkillSnapshot(state,'test-model',now);
  assert.equal(learned.adaptive,true);assert.ok(learned.weights.ATLAS>learned.weights.NOVA);
  assert.ok(learned.weights.NOVA>learned.weights.TITAN);assert.ok(learned.weights.TITAN>learned.weights.ORION);
  close(Object.values(learned.weights).reduce((a,b)=>a+b,0),1);
  assert.ok(Object.values(learned.weights).every(weight=>weight<=.4&&weight>0));
  assert.equal(JSON.stringify(frozen),before);
  const agents=report('blend').agents;
  [.9,.1,.3,.7].forEach((probability,index)=>{agents[index].probability_up=probability;});
  close(blendAgentForecasts(agents,{...frozen,primary_symbol:'TEST'}).probability_up,.5);
  assert.ok(blendAgentForecasts(agents,{...learned,primary_symbol:'TEST'}).probability_up>.5);
  assert.equal(JSON.stringify(frozen),before);
});

test('a single exceptional historical forecaster cannot exceed the four-role weight ceiling',()=>{
  const state={};let now;
  for(let i=0;i<25;i++){
    const r=report('capped-'+i,base+i*7200000);
    r.agents.forEach(agent=>{agent.probability_up=agent.name==='ATLAS'?.99:.01;});
    registerAgentForecasts(state,r,r.finished_at);settle(state,r);now=r.due_at;
  }
  const snapshot=agentSkillSnapshot(state,'test-model',now);
  close(snapshot.weights.ATLAS,.4);
  for(const name of ['ORION','TITAN','NOVA'])close(snapshot.weights[name],.2);
});

test('blend uses frozen available-role weights, excluding abstaining, duplicate, wrong-symbol and sizing/risk forecasts',()=>{
  const snapshot={policy_version:'agent-skill-v1',primary_symbol:'TEST',weights:{ATLAS:.4,ORION:.3,TITAN:.2,NOVA:.1}};
  const agents=[{name:'ATLAS',stance:'bullish',forecast_symbol:'TEST',probability_up:.9},
    {name:'ORION',stance:'abstain',forecast_symbol:'TEST',probability_up:.99},
    {name:'TITAN',stance:'bullish',forecast_symbol:'TEST',probability_up:.3},
    {name:'NOVA',stance:'bullish',forecast_symbol:'OTHER',probability_up:.9},
    {name:'ATLAS',stance:'bullish',forecast_symbol:'TEST',probability_up:0},
    {name:'VEGA',stance:'bullish',forecast_symbol:'TEST',probability_up:1}];
  const result=blendAgentForecasts(agents,snapshot);
  close(result.probability_up,.7);close(result.weights.ATLAS,2/3);close(result.weights.TITAN,1/3);
  assert.deepEqual(result.contributors.map(agent=>agent.name),['ATLAS','TITAN']);
  assert.equal(blendAgentForecasts([{name:'LUNA',probability_up:1}],snapshot).probability_up,null);
});

test('calibration reports actual bin support and neutral skill without exposing private account state or making calls',()=>{
  const state={ai_connection:{ciphertext:'private-key'},cash_cents:100000,positions:[{private:'account'}]};let now;
  for(let i=0;i<20;i++){
    const r=report('calibration-'+i,base+i*7200000);r.agents.forEach(agent=>{agent.probability_up=.5;});
    registerAgentForecasts(state,r,r.finished_at);settle(state,r,i%2?90:110);now=r.due_at;
  }
  const before=JSON.stringify(state),originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('Skill summaries must not call providers');};
  try{
    const summary=agentSkillSummary(state,'test-model',now);
    assert.equal(summary.roles.length,6);assert.equal(summary.orders_enabled,false);assert.equal(summary.provider_calls,0);
    for(const role of summary.roles){close(role.mean_brier,.25);close(role.brier_skill_pct,0);assert.equal(role.calibration[2].count,20);close(role.calibration[2].observed_up_rate,.5);assert.equal(role.calibration[2].sufficient_support,true);assert.equal(role.recent_errors.length,3);}
    assert.ok(!JSON.stringify(summary).includes('private-key'));assert.ok(!JSON.stringify(summary).includes('account'));
    assert.equal(JSON.stringify(state),before);
  }finally{globalThis.fetch=originalFetch;}
});
