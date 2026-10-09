// Monitoring health only: no provider requests, account changes, or secret values.
const monitorLimit=1_000_000_000;
const monitorFinite=v=>typeof v==='number'&&Number.isFinite(v);
const monitorTime=v=>monitorFinite(v)&&v>0?v:null;
const monitorCount=v=>monitorFinite(v)?Math.max(0,Math.min(monitorLimit,Math.floor(v))):0;
const monitorActor=actor=>actor==='scheduler'?'scheduler':'browser';
const monitorCounters=()=>({attempts:0,successes:0,failures:0,skipped:0});
const monitorInterval=value=>Math.max(60,Math.min(86400,Number.isFinite(Number(value))&&Number(value)>0?Number(value):60));
function monitorData(state){
 const current=state.monitoring||{};
 state.monitoring={version:1,browser:{...current.browser,counters:{...monitorCounters(),...current.browser?.counters}},scheduler:{...current.scheduler,counters:{...monitorCounters(),...current.scheduler?.counters}}};
 return state.monitoring;
}
function monitorBump(target,key){target.counters[key]=Math.min(monitorLimit,monitorCount(target.counters[key])+1);}
export function configureMonitoringScheduler(state,{enabled=false,interval_seconds=60}={},now=Date.now()){
 const scheduler=monitorData(state).scheduler;
 scheduler.configured_at=now;scheduler.enabled=enabled===true;scheduler.interval_seconds=monitorInterval(interval_seconds);
 if(!scheduler.enabled){scheduler.owner=false;scheduler.owner_id=null;scheduler.next_due_at=null;scheduler.in_flight=false;}
 return scheduler.enabled;
}
export function recordSchedulerHeartbeat(state,{owner_id,owner=true,next_due_at=null,in_flight=false}={},now=Date.now()){
 const scheduler=monitorData(state).scheduler;
 if(typeof owner_id!=='string'||!owner_id||owner_id.length>100)return false;
 if(!owner&&scheduler.owner_id!==owner_id)return false;
 if(owner){const sameOwner=scheduler.owner_id===owner_id;scheduler.owner_id=owner_id;scheduler.owner=true;scheduler.last_heartbeat_at=now;scheduler.owner_since_at=sameOwner&&scheduler.owner_since_at?scheduler.owner_since_at:now;}
 else{scheduler.owner=false;scheduler.owner_id=null;}
 scheduler.in_flight=in_flight===true;scheduler.next_due_at=monitorTime(next_due_at);
 return true;
}
export function recordSchedulerFailure(state,{owner_id}={},now=Date.now()){
 const scheduler=monitorData(state).scheduler;
 // A waiting replica must not erase the active replica's health.
 if(scheduler.owner_id!==owner_id)return false;
 scheduler.owner=false;scheduler.owner_id=null;scheduler.next_due_at=null;scheduler.in_flight=false;
 scheduler.last_ownership_loss_at=now;scheduler.last_cycle_failed_at=now;scheduler.failure_code='scheduler_connection_lost';
 return true;
}
export function recordSchedulerCycleResult(state,{owner_id,failed=false}={},now=Date.now()){
 const scheduler=monitorData(state).scheduler;
 if(scheduler.owner_id!==owner_id)return false;
 scheduler.last_cycle_completed_at=now;
 if(failed){scheduler.last_cycle_failed_at=now;scheduler.failure_code='monitoring_cycle_failed';}
 else scheduler.failure_code=null;
 return true;
}
export function recordMonitoringAttempt(state,{actor='browser'}={},now=Date.now()){
 const target=monitorData(state)[monitorActor(actor)];
 target.last_attempt_at=now;monitorBump(target,'attempts');
 return true;
}
export function recordMonitoringSuccess(state,{actor='browser',quotes=0,skipped=false}={},now=Date.now()){
 const target=monitorData(state)[monitorActor(actor)];
 if(skipped){target.last_skipped_at=now;monitorBump(target,'skipped');return true;}
 const previous=monitorTime(target.last_success_at),gap=previous&&now>previous?(now-previous)/1000:null;
 if(gap!==null)target.observed_interval_seconds=gap;
 target.last_success_at=now;target.last_quotes=monitorCount(quotes);target.consecutive_failures=0;target.failure_code=null;monitorBump(target,'successes');
 return true;
}
export function recordMonitoringFailure(state,{actor='browser'}={},now=Date.now()){
 const target=monitorData(state)[monitorActor(actor)];
 target.last_failure_at=now;target.consecutive_failures=Math.min(monitorLimit,monitorCount(target.consecutive_failures)+1);target.failure_code='monitoring_refresh_failed';monitorBump(target,'failures');
 return true;
}
function monitorSafeCounters(value){return Object.fromEntries(Object.keys(monitorCounters()).map(key=>[key,monitorCount(value?.[key])]));}
function monitorSafeTime(value,now){const at=monitorTime(value);return at!==null&&at<=now?at:null;}
export function monitoringSummary(state,env={},now=Date.now()){
 const runtime=env.MONITOR_RUNTIME==='vps'?'vps':'sites',data=state.monitoring||{},scheduler=data.scheduler||{},browser=data.browser||{},isVps=runtime==='vps';
 const interval=monitorInterval(env.MONITOR_INTERVAL_SECONDS??scheduler.interval_seconds),staleAfter=Math.max(180,interval*3),enabled=isVps&&env.MONITOR_ENABLED==='true';
 const lastHeartbeat=monitorSafeTime(scheduler.last_heartbeat_at,now),configuredAt=monitorSafeTime(scheduler.configured_at,now),target=isVps?scheduler:browser;
 const lastSuccess=monitorSafeTime(target.last_success_at,now),legacyTick=monitorSafeTime(state.last_tick,now),observedTick=isVps?lastSuccess:(lastSuccess||legacyTick);
 const owner=enabled&&scheduler.owner===true&&lastHeartbeat!==null&&now-lastHeartbeat<=staleAfter*1000;
 let status,reason;
 if(!isVps){status=observedTick===null?'browser_waiting':now-observedTick<=90000?'browser_active':'browser_stale';reason='This hosted desk collects quotes while its signed-in dashboard is open. It has no minute-by-minute background scheduler.';}
 else if(!enabled){status='disabled';reason='Background monitoring is disabled. Set MONITOR_ENABLED=true in Coolify and redeploy when setup is ready.';}
 else{
  const started=configuredAt||lastHeartbeat||monitorSafeTime(state.created_at,now),elapsed=started===null?null:now-started;
  const heartbeatStale=lastHeartbeat!==null&&now-lastHeartbeat>staleAfter*1000,successStale=lastSuccess!==null&&now-lastSuccess>staleAfter*1000;
  if(heartbeatStale||successStale||(!owner&&(elapsed===null||elapsed>staleAfter*1000))||(lastSuccess===null&&elapsed!==null&&elapsed>staleAfter*1000)){status='stalled';reason='The background monitor has missed its expected heartbeat or successful quote-collection window. Check the app and database before relying on paper outcomes.';}
  else if(!owner){status='awaiting_scheduler';reason='Waiting for one app instance to acquire the database scheduler lock.';}
  else if(monitorCount(scheduler.consecutive_failures)>0||scheduler.failure_code){status='degraded';reason='The scheduler is active but its latest cycle failed. It will retry without submitting broker orders.';}
  else if(lastSuccess===null){status='warming_up';reason='The scheduler owns the lock and is waiting for its first completed collection.';}
  else{status='healthy';reason='Background quote collection is completing on the configured sequential schedule.';}
 }
 const browserSuccess=monitorSafeTime(browser.last_success_at,now),browserInterval=monitorFinite(browser.observed_interval_seconds)&&browser.observed_interval_seconds>0?browser.observed_interval_seconds:null;
 const schedulerInterval=monitorFinite(scheduler.observed_interval_seconds)&&scheduler.observed_interval_seconds>0?scheduler.observed_interval_seconds:null;
 const backgroundReady=enabled&&owner&&interval<=120&&lastHeartbeat!==null&&lastSuccess!==null&&now-lastHeartbeat<=150000&&now-lastSuccess<=150000&&monitorCount(scheduler.counters?.successes)>=2&&schedulerInterval!==null&&schedulerInterval<=120&&monitorCount(scheduler.consecutive_failures)===0&&!scheduler.failure_code;
 const browserReady=browserSuccess!==null&&now-browserSuccess<=150000&&monitorCount(browser.counters?.successes)>=2&&browserInterval!==null&&browserInterval<=120&&monitorCount(browser.consecutive_failures)===0;
 return{runtime,mode:isVps?'background':'browser',status,enabled,configured:isVps&&configuredAt!==null,owner,background_ready:backgroundReady,browser_ready:browserReady,interval_seconds:isVps?interval:null,observed_interval_seconds:isVps?schedulerInterval:browserInterval,stale_after_seconds:isVps?staleAfter:90,last_attempt_at:monitorSafeTime(target.last_attempt_at,now),last_success_at:observedTick,last_failure_at:monitorSafeTime(target.last_failure_at,now),last_heartbeat_at:isVps?lastHeartbeat:null,next_due_at:enabled?monitorTime(scheduler.next_due_at):null,in_flight:enabled&&scheduler.in_flight===true,consecutive_failures:monitorCount(target.consecutive_failures),counters:monitorSafeCounters(target.counters),last_quotes:monitorCount(target.last_quotes),reason,browser:{last_attempt_at:monitorSafeTime(browser.last_attempt_at,now),last_success_at:browserSuccess,counters:monitorSafeCounters(browser.counters),observed_interval_seconds:browserInterval},orders_submitted:0};
}
export function updateMonitoringHealth(state,env={},now=Date.now()){
 const summary=monitoringSummary(state,env,now);state.alerts=Array.isArray(state.alerts)?state.alerts:[];
 const active=state.alerts.filter(a=>a.type==='monitoring_stalled'&&!a.resolved_at);
 if(summary.runtime==='vps'&&summary.enabled&&summary.status==='stalled'){
  if(active.length){active[0].updated_at=now;active[0].message=summary.reason;for(const duplicate of active.slice(1)){duplicate.resolved_at=now;duplicate.read=true;}}
  else state.alerts.unshift({id:crypto.randomUUID(),type:'monitoring_stalled',at:now,read:false,message:summary.reason});
 }else if(active.length&&(summary.status==='healthy'||!summary.enabled||summary.runtime!=='vps')){
  for(const alert of active){alert.resolved_at=now;alert.read=true;}
  if(summary.status==='healthy')state.alerts.unshift({id:crypto.randomUUID(),type:'monitoring_recovered',at:now,read:false,message:'Background monitoring recovered; a new successful collection and current scheduler heartbeat are recorded.'});
 }
 state.alerts=state.alerts.slice(0,500);return summary;
}
