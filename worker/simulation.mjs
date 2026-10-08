import {initialState,accountSummary,order,marketKey,fresh} from './paper.mjs';
import {learningWeights} from './learning.mjs';
const simNames=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
function simAccount(now){const a=initialState(now);a.running=true;return a;}
function simInit(state,now){return state.simulation ||= {enabled:true,created_at:now,adaptive:simAccount(now),baseline:simAccount(now),checks:[],cycles:0,history:[],last_test:null};}
function simSignal(samples,weights,learned){
 if(samples.length<6)return{buy:false,exit:false,reason:'Need six distinct fresh observations',drift:0};
 const prices=samples.slice(-12).map(s=>s.price),drift=prices.at(-1)/prices[0]-1;
 const returns=prices.slice(1).map((p,i)=>p/prices[i]-1),mean=returns.reduce((a,b)=>a+b,0)/returns.length;
 const volatility=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length);
 const signal=.25*Math.tanh(drift/.01),probability=weights.momentum*(.5+signal)+weights.mean_reversion*(.5-signal)+weights.neutral*.5;
 return {buy:learned?probability>.53:drift>.003,exit:learned?probability<.48:drift<-.003,drift,volatility,probability,
  reason:learned?'Adaptive probability UP '+(probability*100).toFixed(1)+'%':'Fixed momentum '+(drift*100).toFixed(2)+'%'};
}
function simRun(account,state,enabled,adaptive,now){
 account.markets=state.markets.filter(q=>q.asset_class==='stocks').map(q=>({...q,venue:'Simulation',id:q.symbol}));
 account.running=enabled&&!state.halted;
 const checks=[];
 const push=(name,pass,reason,symbol,stage='gate',evidence={})=>checks.push({agent:name,pass,reason,symbol,at:now,stage,evidence});
 const learned=adaptive&&(state.learning?.evaluated||0)>=20;
 const weights=learningWeights(state.learning?.stats||{});
 for(const p of [...account.positions]){
  const q=account.markets.find(q=>marketKey(q)===p.market_id);
  if(!fresh(q,now)){push('LUNA',false,'Exit waiting for a fresh book; no fill invented',p.symbol,'exit',{quote_at:q?.quote_at||q?.fetched_at||null});continue;}
  const samples=state.learning?.series?.['Alpaca:'+p.symbol]?.samples||[];
  const signal=simSignal(samples,weights,learned),move=q.bid/p.entry_price-1;
  const reason=move<=-.02?'2% stop':move>=.04?'4% target':now-p.opened_at>=3600000?'One-hour holding limit':signal.exit?'Signal reversal':null;
  if(reason){const result=order(account,{intent_id:'sim-exit:'+p.market_id+':'+p.opened_at+':'+now,market_id:p.market_id,side:'sell',rule:reason},now,true);push('LUNA',result.status==='filled',reason,p.symbol,'exit',{bid:q.bid,entry_price:p.entry_price,move_pct:move*100,quote_at:q.quote_at||q.fetched_at,fill_id:result.id||null});}
 }
 const riskSummary=accountSummary(account,now),dayKey=new Date(now).toISOString().slice(0,10);
 if(riskSummary.equity!==null){const day=account.daily[dayKey] ||= {start_cents:Math.round(riskSummary.equity*100)};if(riskSummary.equity*100<=day.start_cents*(1-account.config.daily_loss_pct/100)){account.halted=true;account.halt_reason='Simulation daily loss limit reached';}}
 if(account.running&&!account.halted){
  for(const q of account.markets){
   if(account.positions.some(p=>p.market_id===marketKey(q)))continue;
   const series=state.learning?.series?.['Alpaca:'+q.symbol]?.samples||[];
   const signal=simSignal(series,weights,learned),summary=accountSummary(account,now);
   const book=Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>=q.bid?(q.ask-q.bid)/q.ask:Infinity;
   const evidence=series.length>=6&&series.at(-1).at-series[Math.max(0,series.length-12)].at>=240000;
   const exposure=summary.positions.reduce((sum,p)=>sum+(p.mark??0),0),dollars=Math.max(0,Math.min(summary.cash*.06,(summary.equity||0)*.30-exposure));
   const gates=[['ATLAS',fresh(q,now),'Fresh source quote'],['ORION',evidence,'Six unique quotes across at least four minutes'],['TITAN',signal.buy&&signal.volatility<.03,signal.reason+'; volatility below 3%'],['NOVA',book<=.005&&Math.abs(signal.drift)>book+.002,'Valid book, spread ≤0.5%; signal magnitude exceeds modeled spread and round-trip fees'],['VEGA',summary.equity!==null&&dollars>=1&&account.positions.length<7,'6% cash ticket, 30% exposure, seven slots'],['LUNA',!account.halted&&!state.halted,'Independent halt and daily-loss veto']];
   const inputs={quote_at:q.quote_at||q.fetched_at,price:q.price,bid:q.bid,ask:q.ask,samples:series.length,drift_pct:signal.drift*100,probability_up:signal.probability??null,volatility:signal.volatility??null,spread_pct:Number.isFinite(book)?book*100:null,ticket:dollars,cash:summary.cash,equity:summary.equity,exposure,positions:account.positions.length};
   for(const [name,pass,reason]of gates)push(name,pass,reason,q.symbol,'gate',inputs);
   if(gates.every(g=>g[1])){
    const result=order(account,{intent_id:'sim-entry:'+q.symbol+':'+now,market_id:marketKey(q),side:'buy',dollars},now,true);
    push(result.status==='filled'?'VEGA':'LUNA',result.status==='filled',result.reason||'Simulated entry at ask, including 0.1% modeled fee',q.symbol,'entry',{...inputs,fill_id:result.id||null});
   }
  }
 }
 const summary=accountSummary(account,now);
 if(summary.equity!==null){
  const points=account.performance_stats?[{equity:summary.equity}]:[...account.history,{equity:summary.equity}];
  const prior=account.performance_stats ||= {peak_equity:account.initial_cents/100,max_drawdown_pct:0};
  for(const point of points)if(Number.isFinite(point.equity)){prior.peak_equity=Math.max(prior.peak_equity,point.equity);if(prior.peak_equity>0)prior.max_drawdown_pct=Math.max(prior.max_drawdown_pct,(prior.peak_equity-point.equity)/prior.peak_equity*100);}
 }
 account.history.push({at:now,equity:summary.equity});account.history=account.history.slice(-1000);
 account.decisions=account.decisions.slice(0,200);account.alerts=account.alerts.slice(0,100);
 // Keep the audit ledger intact; the existing 10,000-entry guard stops new entries.
 return checks;
}
export function updateSimulation(state,now=Date.now()){
 const lab=simInit(state,now);if(lab.last_run===now)return simulationSummary(state,now);
 lab.checks=simRun(lab.adaptive,state,lab.enabled,true,now).slice(-100);
 simRun(lab.baseline,state,lab.enabled,false,now);
 lab.cycles++;lab.last_run=now;
 const a=accountSummary(lab.adaptive,now),b=accountSummary(lab.baseline,now);
 lab.history.push({at:now,adaptive_equity:a.equity,baseline_equity:b.equity});lab.history=lab.history.slice(-1000);
 return simulationSummary(state,now);
}
function simMetrics(account,now){
 const summary=accountSummary(account,now),closed=account.ledger.filter(l=>l.side==='sell'),wins=closed.filter(l=>l.realized_pnl>0),loss=closed.reduce((s,l)=>s+Math.max(0,-l.realized_pnl),0),gain=wins.reduce((s,l)=>s+l.realized_pnl,0);
 let peak=account.initial_cents/100,drawdown=0;for(const p of account.history){if(p.equity===null)continue;peak=Math.max(peak,p.equity);drawdown=Math.max(drawdown,(peak-p.equity)/peak*100);}drawdown=Math.max(drawdown,account.performance_stats?.max_drawdown_pct||0);
 return {cash:summary.cash,equity:summary.equity,pnl:summary.pnl,positions:summary.positions,closed_trades:closed.length,win_rate:closed.length?wins.length/closed.length*100:null,profit_factor:loss?gain/loss:null,max_drawdown_pct:drawdown,fees:account.ledger.reduce((s,l)=>s+l.fee,0),halted:account.halted,halt_reason:account.halt_reason,ledger:account.ledger.slice(0,30)};
}
export function simulationSummary(state,now=Date.now()){
 const lab=state.simulation;if(!lab)return{mode:'isolated_simulation',enabled:true,status:'awaiting_cycle',broker_connected:false,cycles:0,checks:[],last_test:null};
 const adaptive=simMetrics(lab.adaptive,now),baseline=simMetrics(lab.baseline,now);
 return{mode:'isolated_simulation',broker_connected:false,enabled:lab.enabled,status:lab.adaptive.halted?'halted':lab.enabled?'running':'paused',cycles:lab.cycles,last_run:lab.last_run,
  adaptive,baseline,improvement:adaptive.pnl===null||baseline.pnl===null?null:adaptive.pnl-baseline.pnl,
  strategy:(state.learning?.evaluated||0)>=20?'Adaptive research weights':'Momentum warm-up; adaptive weights need 20 forward outcomes',
  evidence:adaptive.closed_trades<30?'Insufficient closed trades to assess profitability':'Preliminary forward simulation results; not proof of future profitability',
  checks:lab.checks,last_test:lab.last_test,limits:'$1,000 virtual capital in each account; ask/bid fills plus 0.1% fee each side. Stops are checked on monitoring cycles, not continuous. No broker calls, transfers or live orders.'};
}
export function simulationControl(state,action,now=Date.now()){
 const lab=simInit(state,now);if(!['start','pause'].includes(action))throw Error('Choose start or pause');
 if(action==='start'&&lab.adaptive.halted)throw Error('Simulation is risk-halted; review its results before starting a new experiment');
 lab.enabled=action==='start';return{ok:true,simulation:simulationSummary(state,now)};
}
export function simulationDiagnostic(){
 const base=Date.parse('2026-10-08T08:00:00Z');
 const make=()=>({markets:[],learning:{evaluated:0,stats:{},series:{}},halted:false});
 const step=(s,i,price,bad={})=>{const at=base+i*60000,q={symbol:'TEST',id:'TEST',venue:'Alpaca',asset_class:'stocks',price,bid:price*.9995,ask:price*1.0005,quote_at:new Date(at).toISOString(),...bad};s.markets=[q];const series=s.learning.series['Alpaca:TEST'] ||= {samples:[]};series.samples.push({at,price});return updateSimulation(s,at);};
 const up=make();for(let i=0;i<6;i++)step(up,i,100+i);
 const entry=up.simulation.adaptive.ledger.some(l=>l.side==='buy');
 const allAgents=simNames.every(name=>up.simulation.checks.some(c=>c.agent===name));
 step(up,6,112);const profitable=up.simulation.adaptive.ledger.some(l=>l.side==='sell'&&l.realized_pnl>0);
 const down=make();for(let i=0;i<6;i++)step(down,i,100+i);step(down,6,95);
 const stop=down.simulation.adaptive.ledger.some(l=>l.side==='sell'&&l.rule==='2% stop'&&l.realized_pnl<0);
 const stale=make();for(let i=0;i<6;i++)step(stale,i,100+i,{quote_at:new Date(base-3600000).toISOString()});
 const wide=make();for(let i=0;i<6;i++)step(wide,i,100+i,{bid:90,ask:110});
 const halted=make();halted.halted=true;for(let i=0;i<6;i++)step(halted,i,100+i);
 const checks={all_six_agents_checked:allAgents,entry_filled:entry,target_exit:profitable,loss_stop:stop,stale_quotes_blocked:!stale.simulation.adaptive.ledger.length,wide_spread_blocked:!wide.simulation.adaptive.ledger.length,halt_blocks_entries:!halted.simulation.adaptive.ledger.length,modeled_fees_charged:up.simulation.adaptive.ledger.every(l=>l.fee>0),isolated_accounts:up.simulation.adaptive!==up.simulation.baseline};
 return{at:Date.now(),status:Object.values(checks).every(Boolean)?'passed':'failed',synthetic:true,checks,note:'Synthetic functional tests demonstrate entries, exits and vetoes. They do not demonstrate profitability on real market data.'};
}
