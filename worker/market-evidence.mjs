// Observed quote evidence only. This module never fetches data or executes orders.
const evidenceVersion='market-evidence-v1';
const evidenceDayMs=86400000,evidenceRecentMs=1800000,evidenceFreshMs=90000,evidenceMaxGapMs=300000,evidenceLimit=120;
const evidenceFinite=value=>typeof value==='number'&&Number.isFinite(value);
const evidenceTimestamp=value=>evidenceFinite(value)?value:typeof value==='string'&&value?Date.parse(value):NaN;
const evidenceMedian=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function evidenceTarget(row){
 if(!row||!['stocks','crypto'].includes(row.asset_class)||typeof row.symbol!=='string'||!(/^[A-Z0-9][A-Z0-9./_-]{0,31}$/).test(row.symbol)||typeof row.venue!=='string'||typeof row.id!=='string')return null;
 const market_id=row.venue+':'+row.id;
 if(!(/^[A-Za-z0-9._:/-]{1,120}$/).test(market_id))return null;
 return{symbol:row.symbol,market_id,asset_class:row.asset_class};
}
function evidenceBook(row,now,current=false){
 const source_at=evidenceTimestamp(row?.quote_at),collected_at=evidenceTimestamp(row?.collected_at??(current?undefined:row?.at));
 const price=row?.price,bid=row?.bid,ask=row?.ask;
 const timestamps=evidenceFinite(source_at)&&evidenceFinite(collected_at)&&source_at<=collected_at&&collected_at<=now;
 const bidask=evidenceFinite(price)&&price>0&&evidenceFinite(bid)&&bid>0&&evidenceFinite(ask)&&ask>=bid&&price>=bid&&price<=ask;
 const uncached=row?.cached!==true&&row?.tradable_fresh!==false;
 const age=evidenceFinite(source_at)?(now-source_at)/1000:null;
 const fresh=timestamps&&collected_at-source_at<=evidenceFreshMs&&(!current||now-source_at<=evidenceFreshMs);
 const mid=bidask?(ask+bid)/2:null,spread_pct=bidask?(ask-bid)/mid*100:null;
 const quality={timestamps_valid:timestamps,bidask_valid:bidask,uncached,fresh,source_age_seconds:age,collection_delay_seconds:timestamps?(collected_at-source_at)/1000:null,spread_pct};
 return{valid:timestamps&&bidask&&uncached&&fresh,source_at,collected_at,price,bid,ask,quality};
}
function evidenceCoverage(samples){
 const intervals=samples.slice(1).map((row,index)=>(row.source_at-samples[index].source_at)/1000);
 return{sample_count:samples.length,span_seconds:samples.length>1?(samples.at(-1).source_at-samples[0].source_at)/1000:0,first_source_at:samples[0]?.source_at??null,last_source_at:samples.at(-1)?.source_at??null,median_interval_seconds:evidenceMedian(intervals),max_gap_seconds:intervals.length?Math.max(...intervals):null,gaps_over_five_minutes:intervals.filter(seconds=>seconds>evidenceMaxGapMs/1000).length};
}
function evidenceHours(asset_class,now){
 if(asset_class==='crypto')return{schedule:'24/7',availability_verified:false,note:'Crypto is normally scheduled continuously; exchange availability is not verified.'};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 const minutes=Number(parts.hour)*60+Number(parts.minute),weekday=!['Sat','Sun'].includes(parts.weekday);
 return{schedule:'US weekday regular-hours clock',timezone:'America/New_York',weekday:parts.weekday,local_time:parts.hour+':'+parts.minute,within_regular_hours_clock:weekday&&minutes>=570&&minutes<960,holiday_calendar_verified:false,note:'Clock only; exchange holidays, early closes, halts, and broker open status are not verified.'};
}
function evidenceFeatures(samples,target,now){
 const first=samples[0],last=samples.at(-1),returns=samples.slice(1).map((row,index)=>Math.log(row.price/samples[index].price));
 const mean=returns.length?returns.reduce((sum,value)=>sum+value,0)/returns.length:null;
 const volatility=returns.length>1?Math.sqrt(returns.reduce((sum,value)=>sum+(value-mean)**2,0)/(returns.length-1))*100:null;
 let trend=null;
 if(samples.length>1){
  const xs=samples.map(row=>(row.source_at-first.source_at)/3600000),ys=samples.map(row=>Math.log(row.price));
  const xMean=xs.reduce((sum,value)=>sum+value,0)/xs.length,yMean=ys.reduce((sum,value)=>sum+value,0)/ys.length;
  const denominator=xs.reduce((sum,value)=>sum+(value-xMean)**2,0);
  if(denominator>0)trend=Math.expm1(xs.reduce((sum,value,index)=>sum+(value-xMean)*(ys[index]-yMean),0)/denominator)*100;
 }
 return{evidence_id:'features:primary',symbol:target?.symbol??null,observed_return_pct:first&&last?(last.price/first.price-1)*100:null,linear_trend_pct_per_hour:evidenceFinite(trend)?trend:null,realized_sample_volatility_pct:evidenceFinite(volatility)?volatility:null,volatility_return_count:returns.length,volatility_definition:'Sample standard deviation of successive observed log-price returns; intervals can differ. Not annualized and not one-minute bar volatility.',trend_definition:'Descriptive log-price slope over elapsed source time, expressed per hour; this is not a forecast.',market_hours:target?evidenceHours(target.asset_class,now):null,volume:null,news:null,unknown_fields:['Trade volume','Independent news','Exchange holidays and halts']};
}
function evidenceCosts(book){
 const spread=book.valid?book.quality.spread_pct:null;
 const fee_pct_per_side=.1,slippage_bps_per_side=10;
 const breakEven=book.valid?(book.ask*1.001*1.001/(book.bid*.999*.999)-1)*100:null;
 return{evidence_id:'costs:primary',fee_pct_per_side,slippage_bps_per_side,spread_pct:spread,base_roundtrip_pct:spread===null?null:spread+.4,estimated_break_even_move_pct:breakEven,stressed_roundtrip_pct:spread===null?null:spread*2+.8,stress_multiplier:2,scope:'Approximate round-trip spread plus modeled fees and slippage. Break-even uses the observed bid/ask with 0.1% fee and 10 bps slippage per side. Stress doubles each component. These are assumptions, not verified broker fees or future spreads.'};
}
export function marketEvidence(state,selection={},now=Date.now()){
 const markets=Array.isArray(state?.markets)?state.markets:[],seenTargets=new Set(),available_targets=[];
 for(const row of markets){const target=evidenceTarget(row);if(target&&!seenTargets.has(target.market_id)){seenTargets.add(target.market_id);available_targets.push(target);}}
 const requested=selection&&typeof selection==='object'?selection:{};
 const hasSelection=Object.hasOwn(requested,'symbol')||Object.hasOwn(requested,'market_id');
 const validSelection=(!Object.hasOwn(requested,'symbol')||typeof requested.symbol==='string')&&(!Object.hasOwn(requested,'market_id')||typeof requested.market_id==='string');
 const selected=validSelection?(hasSelection?available_targets.find(target=>(!Object.hasOwn(requested,'symbol')||target.symbol===requested.symbol)&&(!Object.hasOwn(requested,'market_id')||target.market_id===requested.market_id)):available_targets[0])||null:null;
 const selectedRow=selected?markets.find(row=>evidenceTarget(row)?.market_id===selected.market_id&&row.symbol===selected.symbol):null;
 const current=evidenceBook(selectedRow,now,true),bySource=new Map(),conflicts=new Set();
 let rejected_rows=0,duplicate_rows=0;
 const observations=Array.isArray(state?.observations)?state.observations:[];
 const relevant=selected?observations.filter(row=>row?.market_id===selected.market_id&&row?.symbol===selected.symbol&&row?.asset_class===selected.asset_class):[];
 // Include the current book, but preserve a historical row's earlier collection.
 if(selectedRow)relevant.push({...selectedRow,market_id:selected.market_id});
 for(const row of relevant){
  const book=evidenceBook(row,now,false);
  if(!book.valid||book.source_at<now-evidenceDayMs){rejected_rows++;continue;}
  const sample={source_at:book.source_at,collected_at:book.collected_at,price:book.price,bid:book.bid,ask:book.ask};
  const existing=bySource.get(sample.source_at);
  if(existing){
   duplicate_rows++;
   if(existing.price!==sample.price||existing.bid!==sample.bid||existing.ask!==sample.ask)conflicts.add(sample.source_at);
   if(sample.collected_at<existing.collected_at)bySource.set(sample.source_at,sample);
  }else bySource.set(sample.source_at,sample);
 }
 const unique=[...bySource.values()].filter(row=>!conflicts.has(row.source_at)).sort((a,b)=>a.source_at-b.source_at);
 const samples=unique.slice(-evidenceLimit),recent=samples.filter(row=>row.source_at>=now-evidenceRecentMs),coverage=evidenceCoverage(samples),recentCoverage=evidenceCoverage(recent);
 const checks={selected_target:!!selected,current_book:current.valid,spread:current.valid&&current.quality.spread_pct<=.5,distinct_samples:recent.length>=12,span:recentCoverage.span_seconds>=600,cadence:recent.length>1&&recentCoverage.max_gap_seconds<=300};
 const reasons=[];
 if(!checks.selected_target)reasons.push(hasSelection?'Selected symbol or market is not a supported stock or crypto target.':'No supported stock or crypto target is available.');
 if(!checks.current_book)reasons.push('A fresh uncached bid/ask book with verified source and collection timestamps is required.');
 if(!checks.spread)reasons.push('The current observed spread must be at most 0.5%.');
 if(!checks.distinct_samples)reasons.push('Collect at least 12 distinct source quotes in the last 30 minutes.');
 if(!checks.span)reasons.push('Recent distinct source quotes must span at least 10 minutes.');
 if(!checks.cadence)reasons.push('Recent source-quote gaps must be at most five minutes.');
 return{policy_version:evidenceVersion,as_of:now,selected,available_targets,current_book:current.quality,quote:current.valid&&selected?{evidence_id:'quote:primary',...selected,price:current.price,bid:current.bid,ask:current.ask,quote_at:new Date(current.source_at).toISOString(),collected_at:new Date(current.collected_at).toISOString(),spread_pct:current.quality.spread_pct}:null,history:{evidence_id:'history:primary',symbol:selected?.symbol??null,samples,coverage:{...coverage,recent_30m:recentCoverage,eligible_distinct_quotes:unique.length,retained_limit:evidenceLimit,lookback_hours:24,rejected_rows,duplicate_rows,conflicting_source_timestamps:conflicts.size},sampling:'Latest 120 distinct observed source quotes within 24 hours. Irregular observations; not time bars. Repeated timestamps retain their first valid collection and conflicting books are excluded.'},features:evidenceFeatures(samples,selected,now),cost_model:evidenceCosts(current),readiness:{ready:Object.values(checks).every(Boolean),checks,reasons,minimum_distinct_quotes:12,minimum_span_seconds:600,recent_window_seconds:1800,max_gap_seconds:300,max_spread_pct:.5},provider_calls:0,orders_submitted:0};
}
