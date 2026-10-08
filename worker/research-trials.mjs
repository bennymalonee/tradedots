// Pure prospective paper probes. No provider calls, broker orders or shared cash.
const trialVersion='research-shadow-v1';
const trialRoles=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
const trialSettings={long_threshold:.60,ticket_usd:60,fee_pct:.1,slippage_bps:10,entry_delay_seconds:15,entry_window_minutes:10,holding_minutes:60,max_spread_pct:.5,max_probes:100,max_pending_open:10};
const trialFinite=value=>typeof value==='number'&&Number.isFinite(value);
const trialCount=rows=>rows.length;
const trialPending=p=>p.status==='waiting'||p.status==='open';
const trialSum=(rows,key)=>rows.reduce((sum,p)=>sum+(trialFinite(p[key])?p[key]:0),0);
const trialIdentity=value=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,100}$/.test(value);
const trialWeightNames=['ATLAS','ORION','TITAN','NOVA'];

function trialPolicySettings(lab){
 const value=lab?.settings;if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const bounds={long_threshold:[0,1],ticket_usd:[Number.MIN_VALUE,1e6],fee_pct:[0,10],slippage_bps:[0,1000],entry_delay_seconds:[0,3600],entry_window_minutes:[Number.MIN_VALUE,1440],holding_minutes:[Number.MIN_VALUE,10080],max_spread_pct:[Number.MIN_VALUE,20],max_probes:[1,1000],max_pending_open:[1,100]};
 const settings={};
 for(const [key,[min,max]]of Object.entries(bounds)){if(!trialFinite(value[key])||value[key]<min||value[key]>max)return null;settings[key]=value[key];}
 if(!Number.isInteger(settings.max_probes)||!Number.isInteger(settings.max_pending_open)||settings.max_pending_open>settings.max_probes)return null;
 return settings;
}
function trialProvenance(report){
 const snapshot=report?.forecast_snapshot;
 let forecast_snapshot=null;
 if(snapshot&&trialFinite(snapshot.at)&&snapshot.at>=0&&snapshot.at<=report.at&&trialIdentity(snapshot.scheme)){
  const weights={};let sum=0,valid=true;
  for(const name of trialWeightNames){const weight=snapshot.weights?.[name];if(!trialFinite(weight)||weight<0||weight>1){valid=false;break;}weights[name]=weight;sum+=weight;}
  if(valid&&Math.abs(sum-1)<1e-8)forecast_snapshot={at:snapshot.at,scheme:snapshot.scheme,weights};
 }
 return{model:trialIdentity(report?.model)?report.model:null,agent_policy_version:trialIdentity(report?.agent_policy_version)?report.agent_policy_version:null,forecast_snapshot};
}

function trialBook(state,probe,now,settings){
 if(!settings)return null;
 const q=(state.markets||[]).find(q=>q&&q.venue+':'+q.id===probe.market_id&&q.symbol===probe.symbol&&['stocks','crypto'].includes(q.asset_class));
 if(!q||q.cached||!trialFinite(q.price)||q.price<=0||!trialFinite(q.bid)||!trialFinite(q.ask)||q.bid<1e-8||q.ask<q.bid||q.ask>1e9)return null;
 const source_at=Date.parse(q.quote_at),observed_at=Date.parse(q.collected_at||q.fetched_at);
 if(!trialFinite(source_at)||!trialFinite(observed_at)||source_at>observed_at||observed_at>now||now-source_at>90000||(q.ask-q.bid)/q.ask>settings.max_spread_pct/100)return null;
 return{bid:q.bid,ask:q.ask,mid:(q.ask+q.bid)/2,source_at,observed_at};
}
function trialDecision(report,settings){
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
 return{action:'long',reason:'AI forecast met the fixed threshold; all six reviews passed the frozen policy'};
}
function trialSnapshot(probe){
 const safeFill=fill=>fill?{at:fill.at,source_at:fill.source_at,observed_at:fill.observed_at,bid:fill.bid,ask:fill.ask,price:fill.price,quantity:fill.quantity,budget:fill.budget??null,fee:fill.fee,held_seconds:fill.held_seconds??null}:null;
 return{id:probe.id,report_id:probe.report_id,symbol:probe.symbol,market_id:probe.market_id,registered_at:probe.registered_at,report_finished_at:probe.report_finished_at,probability_up:probe.probability_up,policy_action:probe.policy_action,reason:probe.reason,status:probe.status,eligible_at:probe.eligible_at,entry_deadline_at:probe.entry_deadline_at,provenance:trialProvenance({...(probe.provenance||{}),at:probe.registered_at}),entry:safeFill(probe.entry),exit:safeFill(probe.exit),policy_gross_pnl:probe.policy_gross_pnl??null,benchmark_gross_pnl:probe.benchmark_gross_pnl??null,policy_net_pnl:probe.policy_net_pnl??null,benchmark_net_pnl:probe.benchmark_net_pnl??null,paired_net_advantage:probe.paired_net_advantage??null,closed_at:probe.closed_at??null};
}
function trialMetrics(state,lab,now){
 const settings=trialPolicySettings(lab),rows=lab?.probes||[],closed=rows.filter(p=>p.status==='closed'),open=rows.filter(p=>p.status==='open'),n=closed.length;
 const costs=key=>({fees:trialSum(closed,key+'_fees'),slippage:trialSum(closed,key+'_slippage'),spread:trialSum(closed,key+'_spread'),total:trialSum(closed,key+'_fees')+trialSum(closed,key+'_slippage')+trialSum(closed,key+'_spread')});
 return{registered:rows.length,closed_pairs:n,waiting:trialCount(rows.filter(p=>p.status==='waiting')),open:open.length,expired:trialCount(rows.filter(p=>p.status==='expired')),cancelled:trialCount(rows.filter(p=>p.status==='cancelled')),skipped:trialCount(rows.filter(p=>p.status==='skipped')),unpriced_open:open.filter(p=>!trialBook(state,p,now,settings)).length,overdue_open:open.filter(p=>p.exit_due_at<=now).length,policy_gross_pnl:n?trialSum(closed,'policy_gross_pnl'):null,benchmark_gross_pnl:n?trialSum(closed,'benchmark_gross_pnl'):null,policy_net_pnl:n?trialSum(closed,'policy_net_pnl'):null,benchmark_net_pnl:n?trialSum(closed,'benchmark_net_pnl'):null,mean_policy_net:n?trialSum(closed,'policy_net_pnl')/n:null,mean_benchmark_net:n?trialSum(closed,'benchmark_net_pnl')/n:null,paired_net_advantage:n?trialSum(closed,'paired_net_advantage'):null,mean_paired_net_advantage:n?trialSum(closed,'paired_net_advantage')/n:null,costs:{policy:costs('policy'),benchmark:costs('benchmark')},coverage:{registered_reports:rows.length,entered:rows.filter(p=>p.entry).length,closed_pairs:n,closed_fraction:rows.length?n/rows.length:null,waiting_for_entry_quote:rows.filter(p=>p.status==='waiting').length,waiting_for_exit_quote:open.filter(p=>p.exit_due_at<=now).length,expired_without_entry:rows.filter(p=>p.status==='expired').length},capacity_reached:settings?rows.length>=settings.max_probes:false};
}
function trialArchiveSnapshot(archive){
 const cleanMetrics=(value,shape)=>Object.fromEntries(Object.entries(shape).map(([key,fallback])=>[key,fallback&&typeof fallback==='object'?cleanMetrics(value?.[key],fallback):typeof fallback==='boolean'?value?.[key]===true:trialFinite(value?.[key])?value[key]:fallback]));
 return{id:trialIdentity(archive?.id)?archive.id:null,started_at:trialFinite(archive?.started_at)?archive.started_at:null,ended_at:trialFinite(archive?.ended_at)?archive.ended_at:null,policy_version:trialIdentity(archive?.policy_version)?archive.policy_version:null,settings:trialPolicySettings(archive),metrics:cleanMetrics(archive?.metrics,trialMetrics({},null,0))};
}
export function researchTrialsSummary(state,now=Date.now()){
 const lab=state.research_trials,settings=trialPolicySettings(lab),metrics=trialMetrics(state,lab,now),n=metrics.closed_pairs;
 return{mode:'isolated_ai_paper_experiment',experiment:lab?{id:lab.id,status:lab.enabled?'running':'paused',started_at:lab.started_at,paused_at:lab.paused_at||null,policy_version:trialIdentity(lab.policy_version)?lab.policy_version:null,policy_supported:lab.policy_version===trialVersion&&!!settings,settings}:null,evidence_status:n<30?'insufficient_evidence':'preliminary',min_closed_pairs:30,metrics,probes:(lab?.probes||[]).slice(-20).reverse().map(trialSnapshot),archives:(lab?.archives||[]).slice(-2).map(trialArchiveSnapshot),orders_submitted:0,provider_calls:0,note:'Isolated '+(settings?'$'+settings.ticket_usd:'fixed-ticket')+' paper probes compare a frozen AI long-or-flat policy with an equal-ticket always-long benchmark. These totals are not portfolio equity. Only reports and books observed after starting qualify. Missing exits remain open; pausing cancels waiting entries and continues resolving open probes under a supported frozen policy. Modeled spread, fees and slippage reduce returns. Thirty paired outcomes remain preliminary and do not establish future profitability.'};
}
export function researchTrialsControl(state,input={},now=Date.now()){
 if(!['start','pause','resume'].includes(input.action))throw Error('Choose start, pause or resume for the agent experiment');
 const current=state.research_trials;
 if(input.action==='start'){
  if(current&&(current.enabled||current.probes.some(trialPending)))throw Error('Pause the current experiment and resolve its open probes before starting another');
  const archives=current?[...(current.archives||[]),{id:current.id,started_at:current.started_at,ended_at:now,policy_version:trialIdentity(current.policy_version)?current.policy_version:null,settings:trialPolicySettings(current),metrics:trialMetrics(state,current,now)}].slice(-2):[];
  state.research_trials={version:1,id:crypto.randomUUID(),policy_version:trialVersion,settings:{...trialSettings},started_at:now,enabled:true,paused_at:null,probes:[],archives};
 }else{
  if(!current)throw Error('Start an agent experiment first');
  if(input.action==='resume'&&(current.policy_version!==trialVersion||!trialPolicySettings(current)))throw Error('This stored experiment policy is unsupported or invalid; it cannot be resumed');
  current.enabled=input.action==='resume';current.paused_at=current.enabled?null:now;
  if(!current.enabled)for(const p of current.probes)if(p.status==='waiting'){p.status='cancelled';p.reason='Paused before an entry book was captured';p.cancelled_at=now;}
 }
 return{ok:true,...researchTrialsSummary(state,now)};
}
export function registerResearchTrial(state,report,now=Date.now()){
 const lab=state.research_trials;
 if(!lab?.enabled)return{registered:false,reason:'experiment_paused_or_not_started'};
 if(lab.policy_version!==trialVersion)return{registered:false,reason:'unsupported_policy_version'};
 const settings=trialPolicySettings(lab);if(!settings)return{registered:false,reason:'invalid_policy_settings'};
 if(report?.mode!=='ai'||report.status!=='completed'||!trialIdentity(report.id)||!trialFinite(report.at)||report.at<lab.started_at||!trialFinite(report.finished_at)||report.finished_at<report.at||report.finished_at<=lab.started_at||report.finished_at>now)return{registered:false,reason:'report_not_prospective'};
 if(lab.probes.some(p=>p.report_id===report.id))return{registered:false,reason:'already_registered'};
 if(lab.probes.length>=settings.max_probes)return{registered:false,reason:'maximum_probes'};
 const selected=trialDecision(report,settings),market=(state.markets||[]).find(q=>q&&q.venue+':'+q.id===report.market_id&&q.symbol===report.symbol&&['stocks','crypto'].includes(q.asset_class));
 const pending=lab.probes.filter(trialPending).length,validIdentity=trialIdentity(report.market_id)&&typeof report.symbol==='string'&&/^[A-Za-z0-9._/-]{1,40}$/.test(report.symbol)&&!!market;
 const p={id:crypto.randomUUID(),report_id:report.id,registered_at:now,report_finished_at:report.finished_at,market_id:validIdentity?report.market_id:null,symbol:validIdentity?report.symbol:null,probability_up:trialFinite(report.probability_up)&&report.probability_up>=0&&report.probability_up<=1?report.probability_up:null,policy_action:selected.action,reason:selected.reason,provenance:trialProvenance(report),status:validIdentity&&pending<settings.max_pending_open?'waiting':'skipped',eligible_at:report.finished_at+settings.entry_delay_seconds*1000,entry_deadline_at:report.finished_at+settings.entry_delay_seconds*1000+settings.entry_window_minutes*60000,entry:null,exit:null};
 if(!validIdentity)p.reason='No supported stock or crypto market identity for this report';else if(pending>=settings.max_pending_open)p.reason=settings.max_pending_open+' pending or open probes already occupy this experiment';
 lab.probes.push(p);return{registered:p.status==='waiting',reason:p.reason,probe:trialSnapshot(p)};
}
export function updateResearchTrials(state,now=Date.now()){
 const lab=state.research_trials,settings=trialPolicySettings(lab);if(!lab||lab.policy_version!==trialVersion||!settings)return researchTrialsSummary(state,now);
 for(const p of lab.probes){
  if(p.status==='waiting'){
   if(!lab.enabled){p.status='cancelled';p.reason='Paused before an entry book was captured';p.cancelled_at=now;continue;}
   if(now>p.entry_deadline_at){p.status='expired';p.reason='No qualifying future book arrived inside the frozen entry window';continue;}
   const book=trialBook(state,p,now,settings);if(!book||now<p.eligible_at||now<=p.report_finished_at||book.source_at<p.eligible_at||book.observed_at<=p.report_finished_at)continue;
   const price=book.ask*(1+settings.slippage_bps/10000),quantity=settings.ticket_usd/(price*(1+settings.fee_pct/100)),fee=quantity*price*settings.fee_pct/100;
   p.entry={at:book.observed_at,source_at:book.source_at,observed_at:book.observed_at,bid:book.bid,ask:book.ask,mid:book.mid,price,quantity,budget:settings.ticket_usd,fee,slippage:quantity*(price-book.ask),spread:quantity*(book.ask-book.mid)};p.exit_due_at=book.observed_at+settings.holding_minutes*60000;p.status='open';
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
