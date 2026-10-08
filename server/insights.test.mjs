import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../worker/paper.mjs';
import {updateSimulation} from '../worker/simulation.mjs';
import {memoryDocuments,agentTrace,readinessReport,performanceReport} from '../worker/insights.mjs';
import {memoryStore} from './memory.mjs';
function recordedDesk() {
 const state=initialState(),now=Date.now()-600000;state.learning={evaluated:0,stats:{},series:{}};
 for(let i=0;i<7;i++){
  const at=now+i*60000,price=i===6?112:100+i;
  state.markets=[{symbol:'TEST',id:'TEST',venue:'Alpaca',asset_class:'stocks',price,bid:price*.9995,ask:price*1.0005,quote_at:new Date(at).toISOString()}];
  const series=state.learning.series['Alpaca:TEST'] ||= {samples:[]};series.samples.push({at,price});updateSimulation(state,at);
 }
 return state;
}
test('decision traces contain actual inputs and marks stale history honestly',()=>{
 const state=recordedDesk(),last=state.simulation.last_run;
 const trace=agentTrace(state,last);assert.equal(trace.length,6);
 assert.ok(trace.every(a=>a.decisions.length));
 assert.ok(trace.find(a=>a.name==='VEGA').decisions.some(c=>c.evidence.fill_id));
 assert.equal(agentTrace(state,last+180001)[0].status,'stale');
});
test('memory whitelists evidence, preserves outcomes and uses stable record identities',()=>{
 const state=recordedDesk();state.ai_connection={ciphertext:'private-ciphertext'};state.broker={account:{id:'private-account'}};
 state.research={reports:[{id:'round',at:Date.now()-1000,symbol:'TEST',mode:'ai',status:'completed',outcome:{status:'evaluated',brier:.25},agents:[{name:'ATLAS',summary:'spread risk',challenge:'uncertain',evidence_ids:['quote:0']}],evidence:{quotes:[{evidence_id:'quote:0',price:100}]}}]};
 const docs=memoryDocuments(state),again=memoryDocuments(state);
 assert.deepEqual(docs.map(d=>d.id),again.map(d=>d.id));
 assert.equal(new Set(docs.map(d=>d.id)).size,docs.length);
 assert.ok(docs.some(d=>d.kind==='lesson'&&d.evidence.realized_pnl>0));
 assert.ok(docs.some(d=>d.kind==='research'&&d.evidence.outcome.brier===.25));
 assert.ok(!JSON.stringify(docs).includes('private-account'));assert.ok(!JSON.stringify(docs).includes('private-ciphertext'));
});
test('performance separates realized net from stale marks; no success claim on small samples',()=>{
 const state=recordedDesk(),now=state.simulation.last_run;
 const p=performanceReport(state,now);assert.equal(p.status,'insufficient_evidence');
 assert.ok(p.accounts.adaptive.realized_net_pnl>0);assert.ok(p.accounts.adaptive.fees>0);
 assert.equal(p.net_advantage,0);
 assert.ok(Math.abs(p.accounts.adaptive.net_pnl-p.accounts.adaptive.realized_net_pnl-p.accounts.adaptive.unrealized_net_pnl)<1e-9);
 assert.equal(performanceReport(state,now+90001).status,'stale_marks');
 assert.equal(performanceReport(state,now+90001).net_advantage,null);
 assert.equal(performanceReport(state,now+90001).accounts.adaptive.realized_net_pnl,p.accounts.adaptive.realized_net_pnl);
});
test('readiness performs no network, modifies no account and keeps warnings distinct from failures',()=>{
 const state=initialState(),before=JSON.stringify(state),original=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('Readiness must not contact providers');};
 try {
  const r=readinessReport(state,{DB:{},MEMORY:{}});assert.equal(r.status,'needs_attention');assert.equal(r.synthetic.status,'passed');assert.equal(r.orders_submitted,0);assert.equal(JSON.stringify(state),before);
  state.config.ticket_pct=7;assert.equal(readinessReport(state,{DB:{}}).status,'failed');
 }finally{globalThis.fetch=original;}
});
test('memory search binds hostile user queries and bounds result count',async()=>{
 let seen;
 const store=memoryStore({async query(sql,args){seen={sql,args};return{rows:[]};}});
 await store.search({q:"x'; DROP TABLE desk_state; --",limit:100000,agent:'LUNA'});
 assert.ok(!seen.sql.includes('DROP TABLE'));assert.equal(seen.args[0],"x'; DROP TABLE desk_state; --");assert.equal(seen.args[5],50);
});
test('sampled drawdown persists after the chart history rolls off',()=>{
 const state=recordedDesk();
 state.simulation.adaptive.performance_stats={peak_equity:1200,max_drawdown_pct:25};
 state.simulation.adaptive.history=[{at:state.simulation.last_run,equity:1100}];
 const p=performanceReport(state,state.simulation.last_run);assert.equal(p.accounts.adaptive.max_drawdown_pct,25);
});
