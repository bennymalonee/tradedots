// Pure prospective paper probes. No provider calls, broker orders or shared cash.
import {validateReturnForecast} from './return-forecast.mjs';
const trialVersion='research-shadow-v2';
const trialLegacyVersion='research-shadow-v1';
const trialRoles=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
const trialSettings={long_threshold:.60,ticket_usd:60,fee_pct:.1,slippage_bps:10,entry_delay_seconds:15,entry_window_minutes:10,holding_minutes:60,max_spread_pct:.5,max_probes:100,max_pending_open:10,edge_margin_pct:.15,max_downside_pct:3};
const trialFinite=value=>typeof value==='number'&&Number.isFinite(value);
const trialCount=rows=>rows.length;
const trialPending=p=>p.status==='waiting'||p.status==='open';
const trialSum=(rows,key)=>rows.reduce((sum,p)=>sum+(trialFinite(p[key])?p[key]:0),0);
const trialIdentity=value=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,100}$/.test(value);
const trialWeightNames=['ATLAS','ORION','TITAN','NOVA'];
const trialSupported=lab=>[trialVersion,trialLegacyVersion].includes(lab?.policy_version);

function trialPolicySettings(lab){
 const value=lab?.settings;if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const bounds={long_threshold:[0,1],ticket_usd:[Number.MIN_VALUE,1e6],fee_pct:[0,10],slippage_bps:[0,1000],entry_delay_seconds:[0,3600],entry_window_minutes:[Number.MIN_VALUE,1440],holding_minutes:[Number.MIN_VALUE,10080],max_spread_pct:[Number.MIN_VALUE,20],max_probes:[1,1000],max_pending_open:[1,100]};
 const settings={};
 for(const [key,[min,max]]of Object.entries(bounds)){if(!trialFinite(value[key])||value[key]<min||value[key]>max)return null;settings[key]=value[key];}
 if(!Number.isInteger(settings.max_probes)||!Number.isInteger(settings.max_pending_open)||settings.max_pending_open>settings.max_probes)return null;
 if(lab.policy_version===trialVersion){
  for(const [key,[min,max]]of Object.entries({edge_margin_pct:[0,10],max_downside_pct:[0,25]})){if(!trialFinite(value[key])||value[key]<min||value[key]>max)return null;settings[key]=value[key];}
  // Return estimates are defined over exactly sixty minutes from the report reference.
  if(settings.holding_minutes!==60)return null;
 }
 return settings;
}
function trialCohort(report){
 const cohort={};
 for(const key of ['model','agent_policy_version','prompt_version','forecast_policy_version'])if(!trialIdentity(report?.[key]))return null;else cohort[key]=report[key];
 if(!/^[A-Za-z0-9._-]{1,80}$/.test(cohort.model)||cohort.agent_policy_version!=='agent-skill-v2'||cohort.prompt_version!=='research-context-v2'||cohort.forecast_policy_version!=='net-return-v1')return null;
 return cohort;
}
function trialCohortEqual(left,right){return!!left&&!!right&&['model','agent_policy_version','prompt_version','forecast_policy_version'].every(key=>left[key]===right[key]);}
function trialForecastSnapshotValid(report){
 const snapshot=report?.forecast_snapshot;
 return snapshot?.policy_version==='agent-skill-v2'&&snapshot.prompt_version==='research-context-v2'&&snapshot.model===report.model&&snapshot.primary_symbol===report.symbol&&
  trialFinite(snapshot.at)&&snapshot.at>=0&&snapshot.at<=report.at&&trialWeightNames.every(name=>trialFinite(snapshot.weights?.[name])&&snapshot.weights[name]>0&&snapshot.weights[name]<=.4)&&
  Math.abs(trialWeightNames.reduce((sum,name)=>sum+snapshot.weights[name],0)-1)<=1e-10;
}
function trialProvenance(report){
 const snapshot=report?.forecast_snapshot;
 let forecast_snapshot=null;
 if(snapshot&&trialFinite(snapshot.at)&&snapshot.at>=0&&snapshot.at<=report.at&&trialIdentity(snapshot.scheme)){
  const weights={};let sum=0,valid=true;
  for(const name of trialWeightNames){const weight=snapshot.weights?.[name];if(!trialFinite(weight)||weight<0||weight>1){valid=false;break;}weights[name]=weight;sum+=weight;}
  if(valid&&Math.abs(sum-1)<1e-8)forecast_snapshot={at:snapshot.at,scheme:snapshot.scheme,weights};
 }
 const provenance={model:trialIdentity(report?.model)?report.model:null,agent_policy_version:trialIdentity(report?.agent_policy_version)?report.agent_policy_version:null,forecast_snapshot};
 for(const key of ['prompt_version','forecast_policy_version'])if(trialIdentity(report?.[key]))provenance[key]=report[key];
 return provenance;
}

function trialBook(state,probe,now,settings){
 if(!settings)return null;
 const q=(state.markets||[]).find(q=>q&&q.venue+':'+q.id===probe.market_id&&q.symbol===probe.symbol&&['stocks','crypto'].includes(q.asset_class));
 if(!q||q.cached||!trialFinite(q.price)||q.price<=0||!trialFinite(q.bid)||!trialFinite(q.ask)||q.bid<1e-8||q.ask<q.bid||q.ask>1e9)return null;
 const source_at=Date.parse(q.quote_at),observed_at=Date.parse(q.collected_at||q.fetched_at);
 if(!trialFinite(source_at)||!trialFinite(observed_at)||source_at>observed_at||observed_at>now||now-source_at>90000||(q.ask-q.bid)/q.ask>settings.max_spread_pct/100)return null;
 return{bid:q.bid,ask:q.ask,mid:(q.ask+q.bid)/2,source_at,observed_at};
}
function trialDecision(report,settings,version){
 const probability=report.probability_up,agents=Array.isArray(report.agents)?report.agents:[];
 const roles=new Map();
 for(const row of agents){
  if(!row||!trialRoles.includes(row.name)||roles.has(row.name)||!['bullish','bearish','neutral','abstain'].includes(row.stance))return{action:'flat',reason:'Incomplete or duplicate agent reviews'};
  roles.set(row.name,row.stance);
 }
 if(roles.size!==trialRoles.length)return{action:'flat',reason:'All six agent reviews are required'};
 for(const name of ['LUNA','NOVA'])if(['bearish','abstain'].includes(roles.get(name)))return{action:'flat',reason:name+' risk review vetoed a long probe'};
 const abstainer=trialRoles.find(name=>roles.get(name)==='abstain');
 if(abstainer)return{action:'flat',reason:abstainer+' abstained from this review'};
 if(!trialFinite(probability)||probability<0||probability>1)return{action:'flat',reason:'No valid numeric AI direction forecast'};
 if(probability<settings.long_threshold)return{action:'flat',reason:'AI forecast is below the frozen '+(settings.long_threshold*100)+'% long threshold'};
 if(version===trialVersion){
  for(const name of trialRoles){
   const agent=agents.find(row=>row.name===name),checked=validateReturnForecast(agent,report.symbol);
   if(!checked.valid||checked.downside_return_pct===null||(trialWeightNames.includes(name)&&checked.expected_return_pct===null))return{action:'flat',reason:name+' has no complete bounded return or downside estimate for this symbol'};
   if(-checked.downside_return_pct>settings.max_downside_pct)return{action:'flat',reason:name+' estimated downside exceeds the frozen '+settings.max_downside_pct+'% risk limit'};
  }
  const expected=report.return_forecast?.expected_return_pct,downside=report.return_forecast?.downside_return_pct,cost=report.cost_summary?.round_trip_cost_pct;
  if(!trialFinite(expected)||expected< -25||expected>25||!trialFinite(downside)||downside< -25||downside>0)return{action:'flat',reason:'No complete bounded expected-return and downside estimates'};
  if(!trialFinite(cost)||cost<0||cost>25)return{action:'flat',reason:'No valid modeled round-trip cost budget'};
  if(-downside>settings.max_downside_pct)return{action:'flat',reason:'Estimated downside exceeds the frozen '+settings.max_downside_pct+'% risk limit'};
  if(expected<=cost+settings.edge_margin_pct)return{action:'flat',reason:'Expected return does not exceed modeled round-trip costs plus the frozen '+settings.edge_margin_pct+' percentage-point margin'};
  return{action:'long',reason:'Direction, estimated return after costs and downside passed the frozen policy; these are forecasts, not guaranteed returns'};
 }
 return{action:'long',reason:'AI forecast met the fixed threshold; all six reviews passed the frozen policy'};
}
function trialEntryGate(probe,book,settings){
 const fee=settings.fee_pct/100,slip=settings.slippage_bps/10000;
 const round_trip_cost_pct=(book.ask*(1+slip)*(1+fee)/(book.bid*(1-slip)*(1-fee))-1)*100;
 const remaining_expected_return_pct=trialFinite(probe.expected_terminal_mid)&&probe.expected_terminal_mid>0?(probe.expected_terminal_mid/book.mid-1)*100:null;
 const remaining_downside_return_pct=trialFinite(probe.downside_terminal_mid)&&probe.downside_terminal_mid>0?Math.min(0,(probe.downside_terminal_mid/book.mid-1)*100):null;
 const validCost=trialFinite(round_trip_cost_pct)&&round_trip_cost_pct>=0;
 const estimated_net_edge_pct=trialFinite(remaining_expected_return_pct)&&validCost?remaining_expected_return_pct-round_trip_cost_pct:null;
 const forecast=probe.forecast_decision||{action:probe.policy_action,reason:probe.reason};
 let action=forecast.action,reason=forecast.reason;
 if(action==='long'){
  if(!validCost||!trialFinite(remaining_expected_return_pct)||!trialFinite(remaining_downside_return_pct)){action='flat';reason='Entry book cannot support a valid remaining return, cost and downside audit';}
  else if(-remaining_downside_return_pct>settings.max_downside_pct){action='flat';reason='Remaining entry-relative downside exceeds the frozen '+settings.max_downside_pct+'% risk limit';}
  else if(estimated_net_edge_pct<=settings.edge_margin_pct){action='flat';reason='Remaining expected return at the observed entry book does not exceed its modeled round-trip costs plus the frozen '+settings.edge_margin_pct+' percentage-point margin';}
  else reason='Remaining return and downside passed the entry-time audit after observed spread, modeled fees and slippage';
 }
 return{action,reason,observed_at:book.observed_at,source_at:book.source_at,mid:book.mid,remaining_expected_return_pct:trialFinite(remaining_expected_return_pct)?remaining_expected_return_pct:null,remaining_downside_return_pct:trialFinite(remaining_downside_return_pct)?remaining_downside_return_pct:null,round_trip_cost_pct:validCost?round_trip_cost_pct:null,estimated_net_edge_pct};
}
function trialSnapshot(probe){
 const safeFill=fill=>fill?{at:fill.at,source_at:fill.source_at,observed_at:fill.observed_at,bid:fill.bid,ask:fill.ask,price:fill.price,quantity:fill.quantity,budget:fill.budget??null,fee:fill.fee,held_seconds:fill.held_seconds??null}:null;
 const gate=probe.entry_gate;
 const entry_gate=gate?{action:gate.action,reason:gate.reason,observed_at:gate.observed_at,source_at:gate.source_at,mid:gate.mid,remaining_expected_return_pct:gate.remaining_expected_return_pct,remaining_downside_return_pct:gate.remaining_downside_return_pct,round_trip_cost_pct:gate.round_trip_cost_pct,estimated_net_edge_pct:gate.estimated_net_edge_pct}:null;
 return{id:probe.id,report_id:probe.report_id,symbol:probe.symbol,market_id:probe.market_id,registered_at:probe.registered_at,report_finished_at:probe.report_finished_at,probability_up:probe.probability_up,policy_action:probe.policy_action,reason:probe.reason,status:probe.status,eligible_at:probe.eligible_at,entry_deadline_at:probe.entry_deadline_at,forecast_due_at:probe.forecast_due_at??null,exit_due_at:probe.exit_due_at??null,expected_return_pct:probe.expected_return_pct??null,downside_return_pct:probe.downside_return_pct??null,round_trip_cost_pct:probe.round_trip_cost_pct??null,estimated_net_edge_pct:probe.estimated_net_edge_pct??null,reference_price:probe.reference_price??null,expected_terminal_mid:probe.expected_terminal_mid??null,downside_terminal_mid:probe.downside_terminal_mid??null,forecast_decision:probe.forecast_decision?{action:probe.forecast_decision.action,reason:probe.forecast_decision.reason}:null,entry_gate,provenance:trialProvenance({...(probe.provenance||{}),at:probe.registered_at}),entry:safeFill(probe.entry),exit:safeFill(probe.exit),policy_gross_pnl:probe.policy_gross_pnl??null,benchmark_gross_pnl:probe.benchmark_gross_pnl??null,policy_net_pnl:probe.policy_net_pnl??null,benchmark_net_pnl:probe.benchmark_net_pnl??null,paired_net_advantage:probe.paired_net_advantage??null,closed_at:probe.closed_at??null};
}
function trialMetrics(state,lab,now){
 const settings=trialPolicySettings(lab),rows=lab?.probes||[],closed=rows.filter(p=>p.status==='closed'),open=rows.filter(p=>p.status==='open'),n=closed.length;
 const costs=key=>({fees:trialSum(closed,key+'_fees'),slippage:trialSum(closed,key+'_slippage'),spread:trialSum(closed,key+'_spread'),total:trialSum(closed,key+'_fees')+trialSum(closed,key+'_slippage')+trialSum(closed,key+'_spread')});
 return{registered:rows.length,closed_pairs:n,waiting:trialCount(rows.filter(p=>p.status==='waiting')),open:open.length,expired:trialCount(rows.filter(p=>p.status==='expired')),cancelled:trialCount(rows.filter(p=>p.status==='cancelled')),skipped:trialCount(rows.filter(p=>p.status==='skipped')),unpriced_open:open.filter(p=>!trialBook(state,p,now,settings)).length,overdue_open:open.filter(p=>p.exit_due_at<=now).length,policy_gross_pnl:n?trialSum(closed,'policy_gross_pnl'):null,benchmark_gross_pnl:n?trialSum(closed,'benchmark_gross_pnl'):null,policy_net_pnl:n?trialSum(closed,'policy_net_pnl'):null,benchmark_net_pnl:n?trialSum(closed,'benchmark_net_pnl'):null,mean_policy_net:n?trialSum(closed,'policy_net_pnl')/n:null,mean_benchmark_net:n?trialSum(closed,'benchmark_net_pnl')/n:null,paired_net_advantage:n?trialSum(closed,'paired_net_advantage'):null,mean_paired_net_advantage:n?trialSum(closed,'paired_net_advantage')/n:null,costs:{policy:costs('policy'),benchmark:costs('benchmark')},coverage:{registered_reports:rows.length,entered:rows.filter(p=>p.entry).length,closed_pairs:n,closed_fraction:rows.length?n/rows.length:null,waiting_for_entry_quote:rows.filter(p=>p.status==='waiting').length,waiting_for_exit_quote:open.filter(p=>p.exit_due_at<=now).length,expired_without_entry:rows.filter(p=>p.status==='expired').length},capacity_reached:settings?rows.length>=settings.max_probes:false};
}
function trialArchiveSnapshot(archive){
 const cleanMetrics=(value,shape)=>Object.fromEntries(Object.entries(shape).map(([key,fallback])=>[key,fallback&&typeof fallback==='object'?cleanMetrics(value?.[key],fallback):typeof fallback==='boolean'?value?.[key]===true:trialFinite(value?.[key])?value[key]:fallback]));
 return{id:trialIdentity(archive?.id)?archive.id:null,started_at:trialFinite(archive?.started_at)?archive.started_at:null,ended_at:trialFinite(archive?.ended_at)?archive.ended_at:null,policy_version:trialIdentity(archive?.policy_version)?archive.policy_version:null,cohort:trialCohort(archive?.cohort),settings:trialPolicySettings(archive),metrics:cleanMetrics(archive?.metrics,trialMetrics({},null,0))};
}
export function researchTrialsSummary(state,now=Date.now()){
 const lab=state.research_trials,settings=trialPolicySettings(lab),metrics=trialMetrics(state,lab,now),n=metrics.closed_pairs;
 return{mode:'isolated_ai_paper_experiment',experiment:lab?{id:lab.id,status:lab.enabled?'running':'paused',started_at:lab.started_at,paused_at:lab.paused_at||null,policy_version:trialIdentity(lab.policy_version)?lab.policy_version:null,policy_supported:trialSupported(lab)&&!!settings,cohort:trialCohort(lab.cohort),settings,timing:lab.policy_version===trialVersion?'exit_at_report_forecast_due':'exit_after_entry_holding_period'}:null,evidence_status:n<30?'insufficient_evidence':'preliminary',min_closed_pairs:30,metrics,probes:(lab?.probes||[]).slice(-20).reverse().map(trialSnapshot),archives:(lab?.archives||[]).slice(-2).map(trialArchiveSnapshot),orders_submitted:0,provider_calls:0,note:'Isolated '+(settings?'$'+settings.ticket_usd:'fixed-ticket')+' paper probes compare a frozen AI long-or-flat policy with an equal-ticket always-long benchmark. These totals are not portfolio equity. Only reports and books observed after starting qualify. Version 2 freezes a model and forecast cohort, preserves the original reference and predicted terminal midpoint, and rechecks remaining estimated edge, costs and worst-role downside at the observed entry book. The entry cost audit assumes the observed relative spread persists; actual exit costs use the later observed book. An entry-time veto holds the policy flat while the benchmark still enters. Exits follow the original sixty-minute forecast deadline. Legacy version 1 retains its entry-based holding period. Missing exits remain open; pausing cancels waiting entries and continues resolving open probes under a supported frozen policy. Modeled spread, fees and slippage reduce returns. Thirty paired outcomes remain preliminary and do not establish future profitability.'};
}
export function researchTrialsControl(state,input={},now=Date.now()){
 if(!['start','pause','resume'].includes(input.action))throw Error('Choose start, pause or resume for the agent experiment');
 const current=state.research_trials;
 if(input.action==='start'){
  if(current&&(current.enabled||current.probes.some(trialPending)))throw Error('Pause the current experiment and resolve its open probes before starting another');
  const archives=current?[...(current.archives||[]),{id:current.id,started_at:current.started_at,ended_at:now,policy_version:trialIdentity(current.policy_version)?current.policy_version:null,cohort:trialCohort(current.cohort),settings:trialPolicySettings(current),metrics:trialMetrics(state,current,now)}].slice(-2):[];
  state.research_trials={version:2,id:crypto.randomUUID(),policy_version:trialVersion,settings:{...trialSettings},cohort:null,started_at:now,enabled:true,paused_at:null,probes:[],archives};
 }else{
  if(!current)throw Error('Start an agent experiment first');
  if(input.action==='resume'&&(!trialSupported(current)||!trialPolicySettings(current)))throw Error('This stored experiment policy is unsupported or invalid; it cannot be resumed');
  current.enabled=input.action==='resume';current.paused_at=current.enabled?null:now;
  if(!current.enabled)for(const p of current.probes)if(p.status==='waiting'){p.status='cancelled';p.reason='Paused before an entry book was captured';p.cancelled_at=now;}
 }
 return{ok:true,...researchTrialsSummary(state,now)};
}
export function registerResearchTrial(state,report,now=Date.now()){
 const lab=state.research_trials;
 if(!lab?.enabled)return{registered:false,reason:'experiment_paused_or_not_started'};
 if(!trialSupported(lab))return{registered:false,reason:'unsupported_policy_version'};
 const settings=trialPolicySettings(lab);if(!settings)return{registered:false,reason:'invalid_policy_settings'};
 if(report?.mode!=='ai'||report.status!=='completed'||!trialIdentity(report.id)||!trialFinite(report.at)||report.at<lab.started_at||!trialFinite(report.finished_at)||report.finished_at<report.at||report.finished_at<=lab.started_at||report.finished_at>now)return{registered:false,reason:'report_not_prospective'};
 if(lab.probes.some(p=>p.report_id===report.id))return{registered:false,reason:'already_registered'};
 if(lab.probes.length>=settings.max_probes)return{registered:false,reason:'maximum_probes'};
 const selected=trialDecision(report,settings,lab.policy_version),market=(state.markets||[]).find(q=>q&&q.venue+':'+q.id===report.market_id&&q.symbol===report.symbol&&['stocks','crypto'].includes(q.asset_class));
 const pending=lab.probes.filter(trialPending).length,validIdentity=trialIdentity(report.market_id)&&typeof report.symbol==='string'&&/^[A-Za-z0-9._/-]{1,40}$/.test(report.symbol)&&!!market;
 const p={id:crypto.randomUUID(),report_id:report.id,registered_at:now,report_finished_at:report.finished_at,market_id:validIdentity?report.market_id:null,symbol:validIdentity?report.symbol:null,probability_up:trialFinite(report.probability_up)&&report.probability_up>=0&&report.probability_up<=1?report.probability_up:null,policy_action:selected.action,reason:selected.reason,provenance:trialProvenance(report),status:validIdentity&&pending<settings.max_pending_open?'waiting':'skipped',eligible_at:report.finished_at+settings.entry_delay_seconds*1000,entry_deadline_at:report.finished_at+settings.entry_delay_seconds*1000+settings.entry_window_minutes*60000,entry:null,exit:null};
 if(!validIdentity)p.reason='No supported stock or crypto market identity for this report';else if(pending>=settings.max_pending_open)p.reason=settings.max_pending_open+' pending or open probes already occupy this experiment';
 if(lab.policy_version===trialVersion){
  const cohort=trialCohort(report),validHorizon=trialFinite(report.due_at)&&report.due_at===report.at+3600000&&report.due_at>p.eligible_at;
  p.forecast_due_at=validHorizon?report.due_at:null;
  p.entry_deadline_at=validHorizon?Math.min(p.entry_deadline_at,report.due_at-1):p.entry_deadline_at;
  const expected=report.return_forecast?.expected_return_pct,downside=report.return_forecast?.downside_return_pct,cost=report.cost_summary?.round_trip_cost_pct;
  p.expected_return_pct=trialFinite(expected)&&expected>= -25&&expected<=25?expected:null;
  p.downside_return_pct=trialFinite(downside)&&downside>= -25&&downside<=0?downside:null;
  p.round_trip_cost_pct=trialFinite(cost)&&cost>=0&&cost<=25?cost:null;
  p.estimated_net_edge_pct=p.expected_return_pct!==null&&p.round_trip_cost_pct!==null?p.expected_return_pct-p.round_trip_cost_pct:null;
  p.forecast_decision={...selected};
  p.reference_price=trialFinite(report.reference_price)&&report.reference_price>0&&report.reference_price<=1e9?report.reference_price:null;
  p.expected_terminal_mid=p.reference_price!==null&&p.expected_return_pct!==null?p.reference_price*(1+p.expected_return_pct/100):null;
  const downsideRoles=(Array.isArray(report.agents)?report.agents:[]).filter(agent=>trialRoles.includes(agent?.name)).map(agent=>validateReturnForecast(agent,report.symbol).downside_return_pct);
  const worstDownside=downsideRoles.length===trialRoles.length&&downsideRoles.every(trialFinite)?Math.min(...downsideRoles):null;
  p.downside_terminal_mid=p.reference_price!==null&&worstDownside!==null?p.reference_price*(1+worstDownside/100):null;
  p.entry_gate=null;
  if(!cohort){p.status='skipped';p.reason='Report is outside the required version 2 forecast cohort';}
  else if(!trialForecastSnapshotValid(report)){p.status='skipped';p.reason='No valid frozen version 2 forecast weights or symbol snapshot';}
  else if(!validHorizon){p.status='skipped';p.reason='No valid future sixty-minute report forecast deadline';}
  else if(lab.cohort&&!trialCohortEqual(lab.cohort,cohort)){p.status='skipped';p.reason='Model or forecast policy differs from this experiment frozen cohort';}
  else if(validIdentity&&p.status==='waiting'&&!lab.cohort)lab.cohort={...cohort};
 }
 lab.probes.push(p);return{registered:p.status==='waiting',reason:p.reason,probe:trialSnapshot(p)};
}
export function updateResearchTrials(state,now=Date.now()){
 const lab=state.research_trials,settings=trialPolicySettings(lab);if(!lab||!trialSupported(lab)||!settings)return researchTrialsSummary(state,now);
 for(const p of lab.probes){
  if(p.status==='waiting'){
   if(!lab.enabled){p.status='cancelled';p.reason='Paused before an entry book was captured';p.cancelled_at=now;continue;}
   if(now>p.entry_deadline_at){p.status='expired';p.reason='No qualifying future book arrived inside the frozen entry window';continue;}
   const book=trialBook(state,p,now,settings);if(!book||now<p.eligible_at||now<=p.report_finished_at||book.source_at<p.eligible_at||book.observed_at<=p.report_finished_at||book.observed_at>p.entry_deadline_at||(lab.policy_version===trialVersion&&(!trialFinite(p.forecast_due_at)||book.source_at>=p.forecast_due_at||book.observed_at>=p.forecast_due_at)))continue;
   if(lab.policy_version===trialVersion){
    if(!p.forecast_decision)p.forecast_decision={action:p.policy_action,reason:p.reason};
    p.entry_gate=trialEntryGate(p,book,settings);p.policy_action=p.entry_gate.action;p.reason=p.entry_gate.reason;
   }
   const price=book.ask*(1+settings.slippage_bps/10000),quantity=settings.ticket_usd/(price*(1+settings.fee_pct/100)),fee=quantity*price*settings.fee_pct/100;
   p.entry={at:book.observed_at,source_at:book.source_at,observed_at:book.observed_at,bid:book.bid,ask:book.ask,mid:book.mid,price,quantity,budget:settings.ticket_usd,fee,slippage:quantity*(price-book.ask),spread:quantity*(book.ask-book.mid)};p.exit_due_at=lab.policy_version===trialVersion?p.forecast_due_at:book.observed_at+settings.holding_minutes*60000;p.status='open';
  }else if(p.status==='open'&&now>=p.exit_due_at){
   const book=trialBook(state,p,now,settings);if(!book||book.source_at<p.exit_due_at||book.source_at<=p.entry.source_at)continue;
   const price=book.bid*(1-settings.slippage_bps/10000),gross=p.entry.quantity*price,fee=gross*settings.fee_pct/100;
   p.exit={at:book.observed_at,source_at:book.source_at,observed_at:book.observed_at,bid:book.bid,ask:book.ask,mid:book.mid,price,quantity:p.entry.quantity,fee,slippage:p.entry.quantity*(book.bid-price),spread:p.entry.quantity*(book.mid-book.bid),held_seconds:(book.observed_at-p.entry.at)/1000};
   p.benchmark_gross_pnl=p.entry.quantity*(book.mid-p.entry.mid);p.benchmark_net_pnl=gross-fee-p.entry.budget;p.benchmark_fees=p.entry.fee+fee;p.benchmark_slippage=p.entry.slippage+p.exit.slippage;p.benchmark_spread=p.entry.spread+p.exit.spread;
   for(const key of ['gross_pnl','net_pnl','fees','slippage','spread'])p['policy_'+key]=p.policy_action==='long'?p['benchmark_'+key]:0;
   p.paired_net_advantage=p.policy_net_pnl-p.benchmark_net_pnl;p.closed_at=book.observed_at;p.status='closed';
  }
 }
 return researchTrialsSummary(state,now);
}
