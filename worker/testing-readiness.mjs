import {marketEvidence} from './market-evidence.mjs';
import {monitoringSummary} from './monitoring.mjs';
import {connectionSummary} from './connections.mjs';
import {researchTrialsSummary} from './research-trials.mjs';

export function selectedMarketEvidence(state,now=Date.now(),selection={}){
 const symbol=selection.symbol??state.research?.target_symbol;
 if(symbol)return marketEvidence(state,{symbol},now);
 // Prefer a usable current book; a stale stock must not hide a fresh crypto book.
 const candidates=(state.markets||[]).filter(q=>['stocks','crypto'].includes(q.asset_class)&&!q.cached&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.ask>=q.bid&&q.bid>0&&Date.parse(q.quote_at)<=now&&now-Date.parse(q.quote_at)<=90000);
 for(const q of candidates){const evidence=marketEvidence(state,{symbol:q.symbol,market_id:q.venue+':'+q.id},now);if(evidence.readiness.ready)return evidence;}
 if(candidates[0])return marketEvidence(state,{symbol:candidates[0].symbol,market_id:candidates[0].venue+':'+candidates[0].id},now);
 return marketEvidence(state,{},now);
}
export function testingReadiness(state,env={},now=Date.now()){
 const evidence=selectedMarketEvidence(state,now),monitor=monitoringSummary(state,env,now),ai=connectionSummary(state,env);
 const steps=[],add=(id,title,pass,detail,action,blocked=false)=>steps.push({id,title,status:pass?'pass':blocked?'blocked':'waiting',detail,action});
 add('ai','Connect AI research',ai.configured,ai.configured?'An OpenAI API connection is configured. Each new research round uses six requests within the daily cap.':'Connect an OpenAI API key through secure API Setup. ChatGPT subscription billing is separate.',{kind:'api_setup',label:'Open secure AI setup'});
 add('market','Receive a fresh market book',!!evidence.quote,evidence.quote?'Fresh '+evidence.selected.symbol+' bid/ask data is available.':'A fresh stock or crypto bid/ask book is needed. Alpaca data credentials belong in secure hosting settings; GMGN is optional.',{kind:'refresh',label:'Refresh market data'});
 const cadence=monitor.background_ready||monitor.browser_ready;
 add('monitoring','Keep quote collection running',cadence,cadence?(monitor.background_ready?'The VPS background monitor has a current heartbeat and measured quote cadence.':'Recent visible-dashboard collections meet the testing cadence; keep this tab visible.'):(monitor.runtime==='vps'?'Background monitoring needs an enabled scheduler, a current heartbeat, and at least two timely collection cycles.':'Keep this signed-in dashboard open and visible. Two successful monitoring cycles establish cadence; closed or hidden tabs do not provide continuous collection.'),{kind:'monitor_help',label:'Check monitoring setup'},monitor.status==='stalled');
 const recent=evidence.history.coverage.recent_30m;
 add('history','Collect useful price history',evidence.readiness.ready,`${evidence.selected?.symbol||'Selected market'}: ${recent.sample_count}/12 distinct recent quotes across ${Math.floor(recent.span_seconds/60)} minutes. At least ten minutes of history with gaps no larger than five minutes is required.`,{kind:'refresh',label:'Continue collecting quotes'});
 const experiment=state.research_trials;
 const stored=researchTrialsSummary(state,now).experiment,cohort=stored?.cohort;
 const compatible=!stored||(stored.policy_supported&&(!cohort||(cohort.model===(env.OPENAI_RESEARCH_MODEL||'gpt-4.1-mini')&&cohort.agent_policy_version==='agent-skill-v2'&&cohort.prompt_version==='research-context-v2'&&cohort.forecast_policy_version==='net-return-v1')));
 add('experiment','Start the paper experiment',experiment?.enabled===true&&compatible,!compatible?'The stored experiment policy or frozen model cohort differs from the current configuration. Pause it, let open pairs resolve, then start a new experiment.':experiment?.enabled?'The experiment waits for new eligible AI reports and observed future books.':experiment?'The experiment is paused. Review pending/open pairs before resuming.':'Start Agent lab after setup. Starting an experiment does not start paid AI calls.',{kind:'agent_lab',label:'Open Agent lab'},!compatible);
 const hard=steps.find(s=>s.status==='blocked'),missing=steps.find(s=>s.status!=='pass');
 const action=missing?{id:missing.id,label:missing.action.label,action:missing.action}:{id:'research',label:'Run a new AI round',action:{kind:'research',label:'Open Research Room'}};
 return{mode:'paper',status:hard?'blocked':missing?'needs_attention':'ready',next_action:action,steps,selected_symbol:evidence.selected?.symbol||null,market_evidence:evidence,monitoring:{...monitor,last_tick_age_seconds:state.last_tick?Math.max(0,(now-state.last_tick)/1000):null,note:monitor.reason},provider_calls:0,orders_submitted:0};
}
