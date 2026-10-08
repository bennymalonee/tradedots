import {test} from 'node:test';import assert from 'node:assert/strict';
import {learningScorecard,outcomeContext} from '../worker/knowledge.mjs';
import {researchEvidence} from '../worker/research.mjs';
test('scorecard excludes future and invalid forecasts and reports support honestly',()=>{
 const now=10000,state={learning:{evaluated:4,outcomes:[{issued_at:100,scored_at:900,actual:'up',forecast_up:.8},{issued_at:200,scored_at:800,actual:'down',forecast_up:.2},{issued_at:100,scored_at:11000,actual:'up',forecast_up:.8},{issued_at:100,scored_at:900,actual:'up',forecast_up:2}]}};
 const before=JSON.stringify(state),r=learningScorecard(state,now);assert.equal(r.window_samples,2);assert.equal(r.status,'limited_data');assert.ok(Math.abs(r.mean_brier-.04)<1e-12);assert.equal(r.neutral_brier,.25);assert.ok(r.calibration.every(b=>!b.sufficient_support));assert.equal(JSON.stringify(state),before);
});
test('neutral predictions score .25 and no-data score stays unknown',()=>{
 assert.equal(learningScorecard({}).mean_brier,null);
 const r=learningScorecard({learning:{outcomes:[{issued_at:1,scored_at:2,actual:'up',forecast_up:.5}]}},3);assert.equal(r.mean_brier,.25);assert.equal(r.brier_skill_pct,0);
});
test('outcome context excludes current/future and other symbols; never mutates risk or accounts',()=>{
 const state={config:{ticket_pct:6},simulation:{adaptive:{ledger:[{id:'past',symbol:'TEST',at:1,side:'sell',realized_pnl:-2},{id:'future',symbol:'TEST',at:30,side:'sell',realized_pnl:100},{id:'other',symbol:'OTHER',at:1,side:'sell',realized_pnl:5}]}},learning:{outcomes:[{symbol:'TEST',scored_at:2,brier:.16},{symbol:'TEST',scored_at:30,brier:0}]}};
 const before=JSON.stringify(state),r=outcomeContext(state,'TEST',20);assert.equal(r.realized_net,-2);assert.deepEqual(r.trade_ids,['past']);assert.equal(r.mean_brier,.16);assert.equal(JSON.stringify(state),before);
});
test('historical research context does not reveal an outcome scored after its snapshot',()=>{
 const now=10000,state={markets:[{symbol:'TEST',id:'TEST',venue:'Alpaca',asset_class:'stocks',price:100,bid:99,ask:101,quote_at:new Date(now).toISOString()}],sources:[],research:{reports:[{id:'past',symbol:'TEST',mode:'ai',status:'completed',at:100,finished_at:200,agents:[{summary:'Past reasoning'}],outcome:{at:20000,status:'evaluated',return_pct:100}}]}};
 const evidence=researchEvidence(state,now);assert.equal(evidence.memory.length,1);assert.equal(evidence.memory[0].outcome,null);assert.equal(state.research.reports[0].outcome.at,20000);
});
