import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchTrialsControl,registerResearchTrial,updateResearchTrials,researchTrialsSummary} from '../worker/research-trials.mjs';

const BASE=Date.parse('2026-10-08T10:00:00Z');
const ROLES=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
function fixture(){return{markets:[],cash_cents:123456,ledger:[{id:'real-ledger',fee:2}],positions:[{symbol:'OTHER'}],broker:{account:{equity:2000},orders:[{id:'broker-order'}]},research:{reports:[]},simulation:{enabled:true}};}
function book(s,at,mid=100,extra={}){s.markets=[{venue:'Alpaca',id:'TEST',symbol:'TEST',asset_class:'stocks',price:mid,bid:mid*.999,ask:mid*1.001,quote_at:new Date(at).toISOString(),fetched_at:new Date(at).toISOString(),...extra}];}
function report(id='report-1',at=BASE+1000,probability=.8,extra={}){return{id,at,finished_at:at+1000,mode:'ai',status:'completed',market_id:'Alpaca:TEST',symbol:'TEST',reference_price:1,probability_up:probability,agents:ROLES.map(name=>({name,stance:'bullish',summary:'fixture'})),...extra};}
function start(s,at=BASE){researchTrialsControl(s,{action:'start',long_threshold:0,fee_pct:0},at);book(s,at);}
function enter(s,r=report()){registerResearchTrial(s,r,r.finished_at);const at=r.finished_at+15000;book(s,at);updateResearchTrials(s,at);return s.research_trials.probes.at(-1);}
function close(s,p,mid=100,extra={}){const at=p.entry.at+3600000;book(s,at,mid,extra);updateResearchTrials(s,at);return p;}

test('prospective registration rejects old, synthetic, failed and already-started rounds',()=>{
 const s=fixture();start(s);
 for(const r of [report('old',BASE-2000),report('inflight',BASE-500,.8,{finished_at:BASE+1000}),report('preview',BASE+1000,.8,{mode:'preview'}),report('failed',BASE+1000,.8,{status:'failed'}),report('future',BASE+1000,.8,{finished_at:BASE+5000})])assert.equal(registerResearchTrial(s,r,BASE+2000).registered,false);
 assert.equal(s.research_trials.probes.length,0);const r=report();assert.equal(registerResearchTrial(s,r,r.finished_at).registered,true);assert.equal(registerResearchTrial(s,r,r.finished_at).reason,'already_registered');assert.equal(s.research_trials.probes.length,1);
 assert.equal(s.research_trials.settings.long_threshold,.60);assert.equal(s.research_trials.settings.fee_pct,.1);
});
test('entries require a later source book after delay; reference price and old quotes never fill',()=>{
 const s=fixture();start(s);const r=report();registerResearchTrial(s,r,r.finished_at);
 updateResearchTrials(s,r.finished_at);assert.equal(s.research_trials.probes[0].entry,null);
 const eligible=r.finished_at+15000;book(s,eligible-1);updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'waiting');
 book(s,eligible,100,{cached:true});updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'waiting');
 book(s,eligible,100,{bid:90,ask:110});updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'waiting');
 book(s,eligible,100,{quote_at:undefined});updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'waiting');
 book(s,eligible,100,{fetched_at:new Date(r.finished_at-1).toISOString()});updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'waiting');
 book(s,eligible,100,{fetched_at:new Date(r.finished_at-1).toISOString(),collected_at:new Date(eligible).toISOString()});updateResearchTrials(s,eligible);assert.equal(s.research_trials.probes[0].status,'open');
 book(s,eligible,100);updateResearchTrials(s,eligible);const p=s.research_trials.probes[0];assert.equal(p.status,'open');assert.equal(p.entry.source_at,eligible);assert.ok(p.entry.price>100.1);assert.notEqual(p.entry.price,r.reference_price);assert.equal(p.entry.budget,60);
 updateResearchTrials(s,eligible);assert.equal(p.status,'open');assert.equal(p.exit,null);
});
test('flat prices incur real modeled costs and closed paired metrics retain realized losses',()=>{
 const s=fixture();start(s);const p=enter(s);close(s,p,100);
 assert.equal(p.status,'closed');assert.equal(p.benchmark_gross_pnl,0);assert.ok(p.benchmark_net_pnl<0);assert.equal(p.policy_net_pnl,p.benchmark_net_pnl);assert.equal(p.paired_net_advantage,0);assert.equal(p.exit.held_seconds,3600);
 const summary=researchTrialsSummary(s,p.closed_at);const cost=summary.metrics.costs.benchmark;assert.ok(cost.fees>0&&cost.slippage>0&&cost.spread>0);assert.ok(Math.abs(p.benchmark_net_pnl+cost.total)<1e-9);assert.equal(summary.metrics.closed_pairs,1);assert.equal(summary.evidence_status,'insufficient_evidence');
 s.research.reports=[];assert.equal(researchTrialsSummary(s,p.closed_at).metrics.policy_net_pnl,p.policy_net_pnl);
});
test('risk vetoes, missing forecasts and any agent abstention hold policy flat while benchmark buys',()=>{
 const cases=[report('low',BASE+1000,.4),report('missing',BASE+1000,null),report('risk',BASE+1000,.9,{agents:ROLES.map(name=>({name,stance:name==='LUNA'?'bearish':'bullish'}))}),report('abstain',BASE+1000,.9,{agents:ROLES.map(name=>({name,stance:name==='ORION'?'abstain':'bullish'}))}),report('duplicate',BASE+1000,.9,{agents:[...ROLES.slice(0,5).map(name=>({name,stance:'bullish'})),{name:'NOVA',stance:'bullish'}]})];
 for(const r of cases){const s=fixture();start(s);const p=enter(s,r);assert.equal(p.policy_action,'flat');assert.equal(p.status,'open');close(s,p,110);assert.equal(p.policy_net_pnl,0);assert.equal(p.policy_fees,0);assert.ok(p.benchmark_net_pnl>0);assert.equal(p.paired_net_advantage,-p.benchmark_net_pnl);assert.equal(p.policy_gross_pnl,0);}
});
test('entry TTL expires without invented fills, and unsupported market registration is recorded as skipped',()=>{
 const s=fixture();start(s);const r=report();registerResearchTrial(s,r,r.finished_at);const p=s.research_trials.probes[0],late=p.entry_deadline_at+1;book(s,late);updateResearchTrials(s,late);
 assert.equal(p.status,'expired');assert.equal(p.entry,null);assert.equal(researchTrialsSummary(s,late).metrics.expired,1);assert.equal(researchTrialsSummary(s,late).metrics.closed_pairs,0);
 const other=report('solana',late,.9,{market_id:'dex:TOKEN',symbol:'TOKEN'});assert.equal(registerResearchTrial(s,other,other.finished_at).registered,false);assert.equal(s.research_trials.probes.at(-1).status,'skipped');assert.equal(researchTrialsSummary(s,late).metrics.skipped,1);
});
test('missing or stale exits stay open and unpriced; first later valid exit records actual delay',()=>{
 const s=fixture();start(s);const p=enter(s),due=p.exit_due_at;
 book(s,due-1000);updateResearchTrials(s,due);assert.equal(p.status,'open');assert.equal(p.exit,null);
 s.markets=[];const waiting=updateResearchTrials(s,due+1000000);assert.equal(waiting.metrics.unpriced_open,1);assert.equal(waiting.metrics.overdue_open,1);assert.equal(waiting.metrics.closed_pairs,0);assert.equal(p.status,'open');
 book(s,due-200000);updateResearchTrials(s,due+1000000);assert.equal(p.status,'open');
 const actual=due+1800000;book(s,actual,95);updateResearchTrials(s,actual);assert.equal(p.status,'closed');assert.equal(p.exit.held_seconds,5400);assert.ok(p.policy_net_pnl<0);
});
test('pause cancels waiting entries but resolves open probes; manual restart preserves bounded archive totals',()=>{
 const s=fixture();start(s);const p=enter(s);registerResearchTrial(s,report('waiting',p.entry.at+1000),p.entry.at+2000);
 researchTrialsControl(s,{action:'pause'},p.entry.at+3000);assert.equal(s.research_trials.probes[1].status,'cancelled');assert.equal(s.research_trials.probes[0].status,'open');assert.throws(()=>researchTrialsControl(s,{action:'start'},p.entry.at+4000),/resolve its open/);
 close(s,p,95);assert.equal(p.status,'closed');const loss=p.policy_net_pnl;researchTrialsControl(s,{action:'start'},p.closed_at+1000);assert.equal(s.research_trials.probes.length,0);assert.equal(s.research_trials.archives[0].metrics.policy_net_pnl,loss);
 const id=s.research_trials.id;researchTrialsControl(s,{action:'pause'},p.closed_at+2000);researchTrialsControl(s,{action:'resume'},p.closed_at+3000);assert.equal(s.research_trials.id,id);assert.equal(s.research_trials.enabled,true);
 for(let i=0;i<4;i++){researchTrialsControl(s,{action:'pause'},p.closed_at+4000+i*1000);researchTrialsControl(s,{action:'start'},p.closed_at+4500+i*1000);}assert.equal(s.research_trials.archives.length,2);
});
test('bounded probes never trim open work or import full reports and private fields',()=>{
 const s=fixture();start(s);
 for(let i=0;i<110;i++){const r=report('report-'+i,BASE+1000+i*1000,.8,{api_key:'fixture-private',evidence:{private:'fixture-private'}});registerResearchTrial(s,r,r.finished_at);}
 const data=researchTrialsSummary(s,BASE+200000);assert.equal(data.metrics.registered,100);assert.equal(data.metrics.waiting,10);assert.equal(data.metrics.skipped,90);assert.equal(data.metrics.capacity_reached,true);assert.equal(data.probes.length,20);assert.ok(!JSON.stringify(data).includes('fixture-private'));assert.ok(!JSON.stringify(s.research_trials).includes('fixture-private'));
 assert.equal(s.research_trials.probes[0].report_id,'report-0');assert.equal(s.research_trials.probes[0].status,'waiting');
});
test('thirty forward closed pairs remain preliminary and totals represent all probes',()=>{
 const s=fixture();start(s);
 for(let i=0;i<30;i++){const r=report('forward-'+i,BASE+1000+i*7200000,i%2?.4:.8),p=enter(s,r);close(s,p,i%3?101:99);}
 const data=researchTrialsSummary(s,BASE+30*7200000);assert.equal(data.metrics.closed_pairs,30);assert.equal(data.evidence_status,'preliminary');assert.equal(data.min_closed_pairs,30);assert.equal(data.probes.length,20);assert.equal(data.metrics.policy_net_pnl,s.research_trials.probes.reduce((sum,p)=>sum+p.policy_net_pnl,0));assert.ok(data.note.includes('do not establish future profitability'));
});
test('pure trial functions neither query providers nor mutate desk, broker, simulation or research history',t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected provider request');});const s=fixture(),original=structuredClone(s);start(s);const p=enter(s);close(s,p);
 const {research_trials,markets,...after}=s,{markets:beforeMarkets,...before}=original;assert.deepEqual(after,before);const data=researchTrialsSummary(s,p.closed_at);assert.equal(data.orders_submitted,0);assert.equal(data.provider_calls,0);assert.ok(research_trials);
});
test('validated frozen settings control decisions, books, timing, costs, limits and archive display',()=>{
 const s=fixture();start(s);
 const frozen={long_threshold:.75,ticket_usd:120,fee_pct:1,slippage_bps:20,entry_delay_seconds:30,entry_window_minutes:2,holding_minutes:5,max_spread_pct:.1,max_probes:3,max_pending_open:1};
 s.research_trials.settings={...frozen,api_key:'fixture-private'};
 const r=report('frozen',BASE+1000,.7);registerResearchTrial(s,r,r.finished_at);const p=s.research_trials.probes[0];
 assert.equal(p.policy_action,'flat');assert.equal(p.eligible_at,r.finished_at+30000);assert.equal(p.entry_deadline_at,p.eligible_at+120000);
 book(s,p.eligible_at);updateResearchTrials(s,p.eligible_at);assert.equal(p.status,'waiting');
 book(s,p.eligible_at,100,{bid:99.98,ask:100.02});updateResearchTrials(s,p.eligible_at);assert.equal(p.status,'open');
 assert.equal(p.entry.budget,120);assert.equal(p.entry.price,100.02*1.002);assert.equal(p.entry.quantity,120/(p.entry.price*1.01));assert.equal(p.entry.fee,p.entry.quantity*p.entry.price*.01);assert.equal(p.exit_due_at,p.entry.at+300000);
 const second=report('limited',p.entry.at+1000);registerResearchTrial(s,second,second.finished_at);assert.equal(s.research_trials.probes[1].status,'skipped');
 const third=report('expiry',p.entry.at+2000);registerResearchTrial(s,third,third.finished_at);assert.equal(s.research_trials.probes[2].status,'skipped');assert.equal(registerResearchTrial(s,report('full',p.entry.at+3000),p.entry.at+4000).reason,'maximum_probes');
 const shown=researchTrialsSummary(s,p.entry.at);assert.deepEqual(shown.experiment.settings,frozen);assert.ok(shown.note.includes('Isolated $120'));assert.equal(shown.metrics.capacity_reached,true);
 book(s,p.exit_due_at-1,110,{bid:109.98,ask:110.02});updateResearchTrials(s,p.exit_due_at-1);assert.equal(p.status,'open');
 book(s,p.exit_due_at,110,{bid:109.98,ask:110.02});updateResearchTrials(s,p.exit_due_at);assert.equal(p.status,'closed');assert.equal(p.exit.price,109.98*.998);assert.equal(p.exit.fee,p.entry.quantity*p.exit.price*.01);assert.equal(p.exit.held_seconds,300);
 researchTrialsControl(s,{action:'pause'},p.closed_at+1);researchTrialsControl(s,{action:'start'},p.closed_at+2);
 const archived=researchTrialsSummary(s,p.closed_at+2).archives[0];assert.deepEqual(archived.settings,frozen);assert.equal(archived.policy_version,'research-shadow-v1');assert.equal(archived.metrics.benchmark_net_pnl,p.benchmark_net_pnl);assert.equal(s.research_trials.settings.ticket_usd,60);assert.ok(!JSON.stringify(archived).includes('fixture-private'));
});
test('unsupported versions and invalid settings never resume, register or silently process under defaults',()=>{
 const s=fixture();start(s);const p=enter(s);s.research_trials.policy_version='research-shadow-v0';
 const due=p.exit_due_at;book(s,due);assert.equal(registerResearchTrial(s,report('new',due),due+1000).reason,'unsupported_policy_version');updateResearchTrials(s,due);assert.equal(p.status,'open');
 const summary=researchTrialsSummary(s,due);assert.equal(summary.experiment.policy_version,'research-shadow-v0');assert.equal(summary.experiment.policy_supported,false);assert.equal(summary.experiment.settings.ticket_usd,60);
 researchTrialsControl(s,{action:'pause'},due);assert.throws(()=>researchTrialsControl(s,{action:'resume'},due+1),/unsupported or invalid/);assert.equal(s.research_trials.policy_version,'research-shadow-v0');
 s.research_trials.policy_version='research-shadow-v1';s.research_trials.settings.fee_pct=NaN;s.research_trials.enabled=true;
 assert.equal(registerResearchTrial(s,report('invalid',due),due+1000).reason,'invalid_policy_settings');updateResearchTrials(s,due);assert.equal(p.status,'open');assert.equal(researchTrialsSummary(s,due).experiment.settings,null);
 researchTrialsControl(s,{action:'pause'},due);assert.throws(()=>researchTrialsControl(s,{action:'resume'},due+1),/unsupported or invalid/);
 const empty=fixture();start(empty);empty.research_trials.policy_version='research-shadow-v0';researchTrialsControl(empty,{action:'pause'},BASE+1);researchTrialsControl(empty,{action:'start'},BASE+2);assert.equal(researchTrialsSummary(empty,BASE+2).archives[0].policy_version,'research-shadow-v0');assert.equal(empty.research_trials.policy_version,'research-shadow-v1');
});
test('per-probe model and forecast provenance is bounded, whitelisted, immutable and excludes private report data',()=>{
 const s=fixture();start(s);const at=BASE+1000;
 const r=report('provenance',at,.8,{model:'test-model.v1',agent_policy_version:'agent-skill-v1',forecast_snapshot:{at,scheme:'shrunk_brier_softmax_v1',weights:{ATLAS:.4,ORION:.3,TITAN:.2,NOVA:.1,PRIVATE:'fixture-private'},api_key:'fixture-private'},evidence:{secret:'fixture-private'},api_key:'fixture-private'});
 registerResearchTrial(s,r,r.finished_at);r.model='changed-model';r.forecast_snapshot.weights.ATLAS=1;
 const provenance=researchTrialsSummary(s,r.finished_at).probes[0].provenance;
 assert.deepEqual(provenance,{model:'test-model.v1',agent_policy_version:'agent-skill-v1',forecast_snapshot:{at,scheme:'shrunk_brier_softmax_v1',weights:{ATLAS:.4,ORION:.3,TITAN:.2,NOVA:.1}}});assert.ok(!JSON.stringify(s.research_trials).includes('fixture-private'));
 const bad=report('bad-provenance',at+1000,.8,{model:'unsafe model with spaces',agent_policy_version:'x'.repeat(101),forecast_snapshot:{at:at+1001,scheme:'valid',weights:{ATLAS:Infinity,ORION:.25,TITAN:.25,NOVA:.25}}});registerResearchTrial(s,bad,bad.finished_at);
 assert.deepEqual(researchTrialsSummary(s,bad.finished_at).probes[0].provenance,{model:null,agent_policy_version:null,forecast_snapshot:null});
});
