// Evidence summaries are advisory inputs. They do not change rules or submit orders.
export function learningScorecard(state,now=Date.now()) {
 const rows=(state.learning?.outcomes||[]).filter(o=>o.scored_at<=now&&o.issued_at<o.scored_at&&['up','down'].includes(o.actual)&&Number.isFinite(o.forecast_up)&&o.forecast_up>=0&&o.forecast_up<=1).slice(0,100);
 const mean=rows.length?rows.reduce((sum,o)=>sum+(o.forecast_up-(o.actual==='up'?1:0))**2,0)/rows.length:null;
 const calibration=Array.from({length:5},(_,i)=>{
  const bin=rows.filter(o=>Math.min(4,Math.floor(o.forecast_up*5))===i);
  return{range:`${i*20}–${(i+1)*20}%`,count:bin.length,mean_probability:bin.length?bin.reduce((sum,o)=>sum+o.forecast_up,0)/bin.length:null,observed_up_rate:bin.length?bin.filter(o=>o.actual==='up').length/bin.length:null,sufficient_support:bin.length>=20};
 });
 return{status:rows.length>=100?'preliminary':'limited_data',evaluated:state.learning?.evaluated||0,window_samples:rows.length,mean_brier:mean,neutral_brier:.25,brier_skill_pct:mean===null?null:(.25-mean)/.25*100,calibration,
  reason:rows.length<100?'Collecting scored forward forecasts; at least 100 are needed for this preliminary scorecard.':'Recent forecast scorecard; correlated samples and changing markets limit conclusions.',
  scope:'Latest 100 valid scored forward forecasts. Lower Brier is better; 0.25 is the constant 50% forecast. Calibration bins with fewer than 20 observations have limited support. Directional scoring is not trading profit or proof of calibrated probabilities.'};
}
export function outcomeContext(state,symbol,now=Date.now()) {
 const lessons=(state.simulation?.adaptive?.ledger||[]).filter(f=>f.side==='sell'&&f.symbol===symbol&&f.at<now&&Number.isFinite(f.realized_pnl)).slice(0,5);
 const forecasts=(state.learning?.outcomes||[]).filter(o=>o.symbol===symbol&&o.scored_at<now&&Number.isFinite(o.brier)).slice(0,5);
 return{symbol,closed_simulated_trades:lessons.length,realized_net:lessons.length?lessons.reduce((sum,f)=>sum+f.realized_pnl,0):null,trade_ids:lessons.map(f=>f.id),scored_forecasts:forecasts.length,mean_brier:forecasts.length?forecasts.reduce((sum,o)=>sum+o.brier,0)/forecasts.length:null,scope:'Recent recorded outcomes for context; fixed risk gates remain unchanged and a single loss does not establish its cause.'};
}
