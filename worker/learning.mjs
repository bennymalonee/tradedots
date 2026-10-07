// Adaptive research only. This module cannot submit or change an order.
const methods = ['momentum', 'mean_reversion', 'neutral'];
const hour = 3600000, tolerance = 600000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function learningWeights(stats) {
  const enough = methods.every(k => (stats[k]?.count || 0) >= 20);
  const raw = methods.map(k => enough ? Math.exp(-6 * ((stats[k].loss / stats[k].count) - .25)) : 1);
  const sum = raw.reduce((a,b) => a+b, 0);
  return Object.fromEntries(methods.map((k,i) => [k, raw[i]/sum]));
}
export function updateLearning(state, now = Date.now()) {
  const lab = state.learning ||= {version:1,stats:{},series:{},pending:[],outcomes:[],evaluated:0,expired:0,unchanged:0};
  for(const k of methods) lab.stats[k] ||= {count:0,loss:0};
  const fresh = new Map((state.markets || []).filter(q => {
    const t=Date.parse(q.quote_at || q.fetched_at);
    return ['stocks','crypto'].includes(q.asset_class) && !q.cached && Number.isFinite(q.price) && q.price>0 && Number.isFinite(t) && t<=now && now-t<=90000;
  }).slice(0,20).map(q => [q.venue+':'+q.id,q]));
  const waiting=[];
  for(const p of lab.pending){
    if(now>p.due_at+tolerance){lab.expired++;continue;}
    const q=fresh.get(p.market_id),qt=Date.parse(q?.quote_at || q?.fetched_at);
    if(now<p.due_at || !q || qt<p.due_at || qt<=p.quote_at){waiting.push(p);continue;}
    const change=(q.price/p.price-1)*100;
    // Unchanged prices provide no directional outcome and never train weights.
    if(Math.abs(change)<.001){lab.unchanged++;continue;}
    const up=change>0?1:0;
    for(const k of methods){lab.stats[k].count++;lab.stats[k].loss+=(p.probabilities[k]-up)**2;}
    lab.evaluated++;
    lab.outcomes.unshift({symbol:p.symbol,issued_at:p.at,scored_at:now,return_pct:change,forecast_up:p.ensemble,actual:up?'up':'down',brier:(p.ensemble-up)**2,horizon_minutes:(qt-p.quote_at)/60000});
  }
  lab.pending=waiting;lab.outcomes=lab.outcomes.slice(0,100);
  const weights=learningWeights(lab.stats);
  let issued=0;
  for(const [key,q] of fresh){
    const qt=Date.parse(q.quote_at || q.fetched_at);
    const series=lab.series[key] ||= {samples:[],last_issued:0};
    if(!series.samples.length || qt>series.samples.at(-1).at) series.samples.push({at:qt,price:q.price});
    series.samples=series.samples.filter(x=>qt-x.at<=6*hour).slice(-30);
    if(series.samples.length<6 || lab.pending.some(p=>p.market_id===key) || now-series.last_issued<hour)continue;
    const samples=series.samples.slice(-12);
    if(samples.at(-1).at-samples[0].at<240000)continue;
    const drift=q.price/samples[0].price-1;
    const signal=.25*Math.tanh(drift/.01);
    const probabilities={momentum:clamp(.5+signal,.25,.75),mean_reversion:clamp(.5-signal,.25,.75),neutral:.5};
    const ensemble=methods.reduce((sum,k)=>sum+weights[k]*probabilities[k],0);
    lab.pending.push({market_id:key,symbol:q.symbol,at:now,quote_at:qt,due_at:now+hour,price:q.price,probabilities,ensemble,weights:{...weights}});
    series.last_issued=now;issued++;
  }
  // Remove inactive market histories so persisted state stays bounded.
  for(const key of Object.keys(lab.series))if(!fresh.has(key)&&!lab.pending.some(p=>p.market_id===key))delete lab.series[key];
  lab.pending=lab.pending.slice(0,20);lab.last_run=now;lab.last_issued=issued;
  return learningSummary(state);
}
export function learningSummary(state) {
  const lab=state.learning;
  const stats=lab?.stats || Object.fromEntries(methods.map(k=>[k,{count:0,loss:0}]));
  const weights=learningWeights(stats);
  return {mode:'adaptive_research_only',orders_enabled:false,language_model_connected:false,
    status:lab?(lab.evaluated>=20?'adapting':lab.pending.length?'evaluating':'collecting_data'):'awaiting_cycle',
    last_run:lab?.last_run || null,evaluated:lab?.evaluated || 0,expired:lab?.expired || 0,unchanged:lab?.unchanged || 0,
    horizon_minutes:60,min_outcomes:20,pending:lab?.pending || [],outcomes:lab?.outcomes?.slice(0,20) || [],
    methods:methods.map(k=>({name:k,weight:weights[k],evaluated:stats[k]?.count || 0,brier:stats[k]?.count?stats[k].loss/stats[k].count:null})),
    limitations:'Weights adapt from later observed price direction, not trade profit. Forecast probabilities are experimental and uncalibrated. No strategy is promoted to order execution.'};
}
