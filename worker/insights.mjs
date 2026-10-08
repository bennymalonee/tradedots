import {simulationSummary,simulationDiagnostic} from './simulation.mjs';
import {fresh} from './paper.mjs';
const insightNames=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
const insightClip=(v,n=1200)=>String(v??'').slice(0,n);
export function memoryDocuments(state,now=Date.now(),backfill=false) {
 const docs=[];
 for(const r of state.research?.reports||[])for(const a of r.agents||[])docs.push({
  id:`research:${r.id}:${a.name}`,kind:'research',agent:a.name,symbol:r.symbol||'',at:r.at,
  title:`${a.name} ${r.mode} review · ${r.symbol||'workflow'}`,
  text:insightClip(a.summary)+' '+insightClip(a.challenge),
  evidence:{report_id:r.id,mode:r.mode,status:r.status,stance:a.stance,probability_up:a.probability_up,
   citations:a.evidence_ids||[],quotes:r.evidence?.quotes||[],outcome:r.outcome||null}
 });
 for(const account of ['adaptive','baseline'])for(const f of (state.simulation?.[account]?.ledger||[]).slice(0,backfill?20000:200)) {
  docs.push({id:`fill:${account}:${f.id}`,kind:f.side==='sell'?'lesson':'fill',agent:f.side==='sell'?'LUNA':'VEGA',symbol:f.symbol,at:f.at,
   title:`${account} simulated ${f.side} · ${f.symbol}`,
   text:`${f.rule}. Modeled fee ${f.fee}. ${f.side==='sell'?`Observed realized net result ${f.realized_pnl}. This single outcome does not establish a cause or trading edge.`:'Virtual entry only.'}`,
   evidence:{fill_id:f.id,account,side:f.side,quantity:f.quantity,price:f.price,fee:f.fee,realized_pnl:f.realized_pnl??null,rule:f.rule,simulated:true}});
 }
 for(const o of state.learning?.outcomes||[])docs.push({id:`forecast:${o.symbol}:${o.issued_at}`,kind:'forecast',agent:'TITAN',symbol:o.symbol,at:o.scored_at,
  title:`Scored forecast · ${o.symbol} · ${o.actual}`,text:`Forward direction ${o.actual}; Brier ${o.brier}; observed return ${o.return_pct}%. Forecast scoring is not trading profit.`,
  evidence:{issued_at:o.issued_at,scored_at:o.scored_at,forecast_up:o.forecast_up,actual:o.actual,brier:o.brier,return_pct:o.return_pct}});
 for(const c of state.simulation?.checks||[])if(c.at>=now-14*86400000)docs.push({
  id:`decision:${c.at}:${c.agent}:${c.symbol}:${c.stage||'gate'}`,kind:'decision',agent:c.agent,symbol:c.symbol||'',at:c.at,
  title:`${c.agent} · ${c.pass?'PASS':'WAIT / VETO'} · ${c.symbol||'desk'}`,
  text:insightClip(c.reason),evidence:{pass:c.pass,stage:c.stage||'gate',inputs:c.evidence||{},simulated:true}});
 return docs.filter(d=>Number.isFinite(d.at)&&d.id.length<300);
}
export async function syncMemory(env,state,backfill=false) {
 if(!env.MEMORY)return{available:false};
 await env.MEMORY.upsert(memoryDocuments(state,Date.now(),backfill));
 return env.MEMORY.stats();
}
export function performanceReport(state,now=Date.now()) {
 const sim=simulationSummary(state,now),a=sim.adaptive,b=sim.baseline;
 if(!a||!b)return{status:'collecting',reason:'No simulation cycles recorded',samples:0,curve:[],net_advantage:null};
 const accounts={};
 for(const [name,account]of [['adaptive',a],['baseline',b]]) {
  const closed=state.simulation[name].ledger.filter(x=>x.side==='sell'),pnls=closed.map(x=>Number(x.realized_pnl));
  const realized=pnls.reduce((s,x)=>s+x,0),mean=pnls.length?realized/pnls.length:null;
  const initial=state.simulation[name].initial_cents/100;
  accounts[name]={net_pnl:account.pnl,realized_net_pnl:realized,unrealized_net_pnl:account.pnl===null?null:account.pnl-realized,
   return_pct:account.pnl===null?null:account.pnl/initial*100,fees:account.fees,closed_trades:closed.length,
   mean_trade_net:mean,win_rate:account.win_rate,profit_factor:account.profit_factor,max_drawdown_pct:account.max_drawdown_pct,
   open_positions:account.positions.length,marks_fresh:account.equity!==null};
 }
 const enough=a.closed_trades>=30&&b.closed_trades>=30,valid=a.pnl!==null&&b.pnl!==null;
 return{status:!valid?'stale_marks':enough?'preliminary':'insufficient_evidence',samples:Math.min(a.closed_trades,b.closed_trades),accounts,
  net_advantage:valid?a.pnl-b.pnl:null,
  curve:(state.simulation.history||[]).slice(-120),
  reason:!valid?'At least one account has stale position marks; comparison is unavailable':enough?'Preliminary forward comparison; no statistical significance or future profitability claim':'Both accounts need at least 30 closed trades before a preliminary comparison',
  assumptions:'Equal starting capital; observed ask/bid and 0.1% modeled fee per side. Unrealized marks exclude future exit fees. Drawdown is sampled, not continuous. This is an observational comparison, not a randomized or independent validation.'};
}
export function agentTrace(state,now=Date.now()) {
 const checks=state.simulation?.checks||[];
 return insightNames.map(name=>{
  const rows=checks.filter(c=>c.agent===name).slice(-12).reverse();
  const reviews=(state.research?.reports||[]).flatMap(r=>(r.agents||[]).filter(a=>a.name===name).map(a=>({at:r.finished_at||r.at,mode:r.mode,status:r.status,symbol:r.symbol,summary:a.summary,citations:a.evidence_ids,outcome:r.outcome||null}))).slice(0,3);
  const last=rows[0];
  const waitingReason=state.simulation?.enabled===false?'Simulation entries are paused; protective exit checks still apply':!state.markets.some(q=>q.asset_class==='stocks'&&fresh(q,now))?'Waiting for fresh eligible stock quotes':state.simulation?.adaptive?.positions?.length?'No new entry candidate; existing positions remain under monitoring':'No recorded simulation task yet. Waiting is not a failure.';
  return{name,status:!last?'waiting':now-last.at>180000?'stale':last.pass?'passed':'waiting_or_vetoed',
   reason:last?.reason||waitingReason,last_at:last?.at||null,
   decisions:rows,reviews};
 });
}
export function readinessReport(state,env,now=Date.now()) {
 const diagnostic=simulationDiagnostic(),quotes=state.markets.filter(q=>q.asset_class==='stocks'&&fresh(q,now));
 const checks=[];
 const add=(id,status,detail)=>checks.push({id,status,detail});
 add('database',env.DB?'pass':'fail','Persistent state connection');
 add('memory',env.MEMORY?'pass':'warning','Searchable archive configured');
 add('fresh_stock_quotes',quotes.length?'pass':'warning',`${quotes.length} fresh stock quotes; simulation entries require stocks`);
 for(const name of insightNames)add('agent_'+name,state.simulation?.checks?.some(c=>c.agent===name)?'pass':'warning',`${name}: recorded task evidence in the most recent simulation cycle; waiting or a risk veto can be valid`);
 add('simulation_functional_checks',diagnostic.status==='passed'?'pass':'fail',`${Object.values(diagnostic.checks).filter(Boolean).length}/${Object.keys(diagnostic.checks).length} isolated synthetic checks`);
 add('isolation',!state.simulation?'warning':state.simulation.adaptive===state.simulation.baseline?'fail':'pass','Distinct virtual accounts; broker execution remains manual');
 add('risk_limits',Number.isFinite(state.config.ticket_pct)&&state.config.ticket_pct>0&&state.config.ticket_pct<=6&&Number.isFinite(state.config.exposure_pct)&&state.config.exposure_pct>0&&state.config.exposure_pct<=30&&Number.isInteger(state.config.max_positions)&&state.config.max_positions>0&&state.config.max_positions<=7?'pass':'fail','Configured ticket, exposure and position ceilings');
 for(const source of state.sources)add('source_'+source.key,['connected','empty'].includes(source.status)?'pass':'warning',`${source.status}${source.retry_at?' · automatic retry '+source.retry_at:''}`);
 add('desk_halt',state.halted?'warning':'pass',state.halt_reason||'No desk halt');
 add('ai_connection',(env.OPENAI_API_KEY||state.ai_connection?.ciphertext)?'pass':'warning','AI is optional; free preview works without a model');
 add('forecast_evidence',(state.learning?.evaluated||0)>=20?'pass':'warning',`${state.learning?.evaluated||0} scored forward forecasts`);
 const performance=performanceReport(state,now);
 add('performance_evidence',performance.status==='preliminary'?'pass':'warning',performance.reason);
 return{at:now,status:checks.some(c=>c.status==='fail')?'failed':checks.some(c=>c.status==='warning')?'needs_attention':'checks_passed',
  checks,synthetic:diagnostic,scope:'Functional and current configuration checks. Not a security audit, provider connectivity test, deployment certification or proof of profitable trading.',orders_submitted:0};
}
