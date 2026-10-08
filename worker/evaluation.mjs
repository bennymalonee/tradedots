// Pure historical simulation. It has no provider, broker, or state-writing tools.
const evalMinimum={min_samples:120,min_train_samples:60,min_test_samples:30,candidate_count:9};
const evalCandidates=[3,5,10].flatMap(lookback=>[.05,.1,.2].map(threshold=>({lookback_samples:lookback,threshold_pct:threshold})));
function evalSetting(input,key,fallback,min,max) {
 const value=input[key]===undefined?fallback:Number(input[key]);
 if(!Number.isFinite(value)||value<min||value>max)throw Error(`${key} must be between ${min} and ${max}`);
 return value;
}
function evalRun(rows,warmup,settings,candidate,baseline=false,trace=true) {
 let cash=settings.initial_cash,position=null,fees=0,slippage=0,spread=0,closed=0,wins=0,peak=cash,drawdown=0;
 const fee=settings.fee_pct/100,slip=settings.slippage_bps/10000,prices=warmup.map(q=>q.price),trades=[],curve=[];
 const buy=q=>{
  const budget=(baseline?settings.initial_cash:cash)*.06,price=q.ask*(1+slip);
  if(budget<1||budget>cash)return;
  const quantity=budget/(price*(1+fee)),cost=quantity*price,charge=cost*fee;
  cash-=cost+charge;fees+=charge;slippage+=quantity*(price-q.ask);spread+=quantity*(q.ask-q.price);
  position={quantity,entry_price:price,cost:cost+charge};
  if(trace)trades.push({at:q.at,side:'buy',price,quantity,fee:charge});
 };
 const sell=q=>{
  const price=q.bid*(1-slip),proceeds=position.quantity*price,charge=proceeds*fee;
  const net=proceeds-charge;cash+=net;fees+=charge;slippage+=position.quantity*(q.bid-price);spread+=position.quantity*(q.price-q.bid);
  if(trace)trades.push({at:q.at,side:'sell',price,quantity:position.quantity,fee:charge,realized_net:net-position.cost});
  closed++;if(net>position.cost)wins++;position=null;
 };
 for(let i=0;i<rows.length;i++) {
  const q=rows[i],past=prices.at(-candidate.lookback_samples),drift=past?q.price/past-1:0;
  const threshold=candidate.threshold_pct/100,final=i===rows.length-1;
  if(position){const move=q.bid*(1-slip)/position.entry_price-1;if(final||(!baseline&&(drift<=-threshold||move<=-.02||move>=.04)))sell(q);}
  else if(!final&&((baseline&&i===0)||(!baseline&&prices.length>=candidate.lookback_samples&&drift>=threshold)))buy(q);
  const liquidation=position?position.quantity*q.bid*(1-slip)*(1-fee):0,equity=cash+liquidation;
  peak=Math.max(peak,equity);if(peak>0)drawdown=Math.max(drawdown,(peak-equity)/peak*100);
  if(trace)curve.push({at:q.at,equity});
  prices.push(q.price);if(prices.length>10)prices.shift();
 }
 const pnl=cash-settings.initial_cash;
 return{net_pnl:pnl,return_pct:pnl/settings.initial_cash*100,final_equity:cash,closed_trades:closed,win_rate:closed?wins/closed*100:null,max_drawdown_pct:drawdown,fees,slippage_cost:slippage,spread_cost:spread,open_positions:position?1:0,...(trace?{trades:trades.slice(-200),curve:curve.slice(-120),trace_limits:{trades:200,curve:120}}:{})};
}
export function evaluationReport(state,input={},now=Date.now()) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Evaluation settings must be an object');
 const settings={initial_cash:evalSetting(input,'initial_cash',1000,10,1000000),fee_pct:evalSetting(input,'fee_pct',.1,0,2),slippage_bps:evalSetting(input,'slippage_bps',10,0,100),train_fraction:evalSetting(input,'train_fraction',.7,.5,.8),allocation_pct:6};
 const observations=Array.isArray(state.observations)?state.observations:[],received=observations.length;
 const data={received,examined:Math.min(received,40000),valid:0,symbols_evaluated:0,symbols_omitted:0,excluded:{unsupported:0,invalid_book:0,invalid_time:0,duplicates:0,missing_source_timestamp:0},limits:{max_symbols:6,max_samples_per_symbol:5000,max_observations_examined:40000}};
 const groups=new Map();
 for(const row of observations.slice(-40000)) {
  if(!row||!['stocks','crypto'].includes(row.asset_class)||typeof row.symbol!=='string'||!/^[A-Za-z0-9._/-]{1,40}$/.test(row.symbol)){data.excluded.unsupported++;continue;}
  if(!Number.isFinite(row.price)||row.price<=0||!Number.isFinite(row.bid)||!Number.isFinite(row.ask)||row.bid<1e-8||row.ask>1e9||row.ask<row.bid||(row.ask-row.bid)/row.ask>.05){data.excluded.invalid_book++;continue;}
  const hasSource=row.quote_at!==undefined&&row.quote_at!==null,sourceAt=hasSource?Date.parse(row.quote_at):row.at;
  if(!Number.isFinite(row.at)||row.at>now||!Number.isFinite(sourceAt)||sourceAt>row.at||row.at-sourceAt>90000){data.excluded.invalid_time++;continue;}
  if(!hasSource)data.excluded.missing_source_timestamp++;
  const key=String(row.market_id||row.asset_class+':'+row.symbol),group=groups.get(key)||{symbol:row.symbol,market_id:key,rows:[]};
  // Collection time is the first time the desk could use this book. Source time
  // de-duplicates repeated polls; legacy records have collection time only.
  group.rows.push({at:row.at,source_at:sourceAt,price:(row.bid+row.ask)/2,bid:row.bid,ask:row.ask});groups.set(key,group);
 }
 const ordered=[...groups.values()].sort((a,b)=>a.market_id.localeCompare(b.market_id));
 const symbols=[];data.symbols_omitted=Math.max(0,ordered.length-6);
 for(const group of ordered.slice(0,6)) {
  const seen=new Set(),unique=group.rows.sort((a,b)=>a.at-b.at||a.source_at-b.source_at).filter(q=>{if(seen.has(q.source_at)){data.excluded.duplicates++;return false;}seen.add(q.source_at);return true;});
  data.valid+=unique.length;
  const rows=unique.slice(-5000);let splitAt=Math.floor(rows.length*settings.train_fraction);
  while(splitAt>0&&splitAt<rows.length&&rows[splitAt-1].at===rows[splitAt].at)splitAt--;
  const train=rows.slice(0,splitAt),test=rows.slice(splitAt);
  const result={symbol:group.symbol,market_id:group.market_id,samples_available:unique.length,samples_used:rows.length,dropped_for_limit:Math.max(0,unique.length-rows.length)};
  if(rows.length<evalMinimum.min_samples||train.length<evalMinimum.min_train_samples||test.length<evalMinimum.min_test_samples) {
   symbols.push({...result,status:'insufficient_data',reason:`Need ${evalMinimum.min_samples} distinct sampled observations with a valid book; found ${rows.length}. Training needs ${evalMinimum.min_train_samples}, later test needs ${evalMinimum.min_test_samples}.`});continue;
  }
  const ranked=evalCandidates.map(candidate=>({candidate,metrics:evalRun(train,[],settings,candidate,false,false)})).sort((a,b)=>b.metrics.net_pnl-a.metrics.net_pnl||a.candidate.lookback_samples-b.candidate.lookback_samples||a.candidate.threshold_pct-b.candidate.threshold_pct);
  const selected=ranked[0].candidate,training=evalRun(train,[],settings,selected),later=evalRun(test,train.slice(-10),settings,selected),baseline=evalRun(test,[],settings,selected,true);
  symbols.push({...result,status:'completed',candidate_count:evalCandidates.length,selected,training,test:later,baseline,delta:{net_pnl:later.net_pnl-baseline.net_pnl,return_pct:later.return_pct-baseline.return_pct},split:{train:{samples:train.length,start_at:train[0].at,end_at:train.at(-1).at},test:{samples:test.length,start_at:test[0].at,end_at:test.at(-1).at}}});data.symbols_evaluated++;
 }
 return{at:now,status:data.symbols_evaluated?'completed':'insufficient_data',settings,requirements:evalMinimum,data,symbols,
  method:'Nine fixed momentum candidates are ranked by training net P&L only. The winner is frozen for the later test; fixed exits use a 2% stop, 4% target or opposite momentum signal. Both test accounts start with the same cash and use a 6% ticket: strategy uses free cash; buy-and-hold uses initial cash. Only prior observations warm up the signal; positions and cash never carry across the split. Each period ends with liquidation, including modeled exit costs.',
  limitations:['One chronological holdout on recorded sampled books, not independent validation of all six agents. Repeatedly rerunning after examining results can overfit the later period.','Observed ask/bid fills assume available liquidity. Fees and adverse slippage are modeled per side; latency, partial fills, corporate actions and funding costs are not modeled.','Legacy observations contain collection timestamps only and may repeat the same underlying quote. New source timestamps de-duplicate repeated polls. Samples are not necessarily independent.','Sparse monitoring and overnight gaps can miss intraperiod moves and stop prices. Drawdown is sampled and assumes liquidation at each observed book.','Candidate selection can overfit training. No strategy is promoted or risk setting changed; a positive net result or baseline advantage does not establish statistical significance or future profitability.'],orders_submitted:0,provider_calls:0};
}
