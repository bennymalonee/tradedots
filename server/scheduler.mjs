import {randomUUID} from 'node:crypto';
import {mutate} from '../worker/paper.mjs';
import {configureMonitoringScheduler,recordSchedulerHeartbeat,recordSchedulerFailure,recordSchedulerCycleResult,updateMonitoringHealth} from '../worker/monitoring.mjs';

const schedulerLock=734021;
const schedulerLockCheck='SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND pid=pg_backend_pid() AND classid=0 AND objid=$1::oid AND objsubid=1 AND granted) AS acquired';
// Each process uses one dedicated session lock. Waiting processes retry so a
// replica can take over after a restart. A failed session is never reused.
export async function createMonitoringScheduler({pool,env,refresh,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,persist=null,log=()=>{}}){
 if(typeof refresh!=='function')throw Error('Monitoring refresh function required');
 const save=persist||((operation)=>mutate(env.DB,operation));
 const enabled=env.MONITOR_ENABLED==='true',interval=Math.max(60,Math.min(86400,Number.isFinite(Number(env.MONITOR_INTERVAL_SECONDS))&&Number(env.MONITOR_INTERVAL_SECONDS)>0?Number(env.MONITOR_INTERVAL_SECONDS):60))*1000;
 let ownerId=randomUUID(),timer=null,client=null,clientError=null,lockValid=false,stopped=false,inFlight=null,busy=false;
 const healthSave=async operation=>save(state=>{const result=operation(state);updateMonitoringHealth(state,{...env,MONITOR_RUNTIME:'vps'},clock());return result;});
 await healthSave(state=>configureMonitoringScheduler(state,{enabled,interval_seconds:interval/1000},clock()));
 function schedule(delay=interval){if(stopped||!enabled)return;if(timer!==null)clearTimer(timer);timer=setTimer(()=>{timer=null;void runOnce();},delay);}
 async function dispose(unlock=false){
  const released=client;if(!released)return;const wasValid=lockValid;client=null;lockValid=false;
  if(clientError)released.off?.('error',clientError);clientError=null;
  let destroy=!wasValid;
  if(unlock&&wasValid){try{await released.query('SELECT pg_advisory_unlock($1::bigint)',[schedulerLock]);}catch{destroy=true;}}
  released.release(destroy);
 }
 async function loseOwnership(){
  lockValid=false;
  try{await healthSave(state=>recordSchedulerFailure(state,{owner_id:ownerId},clock()));}catch{}
  await dispose(false);log('Monitoring scheduler connection lost; retrying with a new session');
 }
 async function acquire(){
  if(client&&lockValid)return true;
  if(client)await dispose(false);
  const candidate=await pool.connect(),candidateOwner=randomUUID();client=candidate;lockValid=false;
  clientError=()=>{if(client!==candidate)return;lockValid=false;void healthSave(state=>recordSchedulerFailure(state,{owner_id:candidateOwner},clock())).catch(()=>{});};candidate.on?.('error',clientError);
  const result=await candidate.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired',[schedulerLock]);
  if(result.rows?.[0]?.acquired!==true){candidate.off?.('error',clientError);clientError=null;client=null;candidate.release();return false;}
  ownerId=candidateOwner;lockValid=true;return true;
 }
 async function cycle(){
  if(stopped||!enabled||busy)return{skipped:true};busy=true;
  try{
   if(!await acquire())return{skipped:true,waiting_for_owner:true};
   const verified=await client.query(schedulerLockCheck,[schedulerLock]);
   if(!lockValid||verified.rows?.[0]?.acquired!==true){await loseOwnership();return{skipped:true,ownership_lost:true};}
   await healthSave(state=>recordSchedulerHeartbeat(state,{owner_id:ownerId,owner:true,in_flight:true},clock()));
   if(stopped||!lockValid){await loseOwnership();return{skipped:true,ownership_lost:true};}
   let failed=false,result;
   try{result=await refresh(env,{actor:'scheduler'});if(Number(result?.orders_submitted||0)!==0)throw Error('Unexpected broker execution');}
   catch{failed=true;log('Monitoring cycle failed; will retry next interval');}
   if(!lockValid){await loseOwnership();return{skipped:true,ownership_lost:true};}
   await healthSave(state=>{recordSchedulerCycleResult(state,{owner_id:ownerId,failed},clock());recordSchedulerHeartbeat(state,{owner_id:ownerId,owner:true,in_flight:false,next_due_at:clock()+interval},clock());});
   return failed?{failed:true}:result;
  }catch{await loseOwnership();return{failed:true};}
  finally{busy=false;schedule();}
 }
 function runOnce(){if(busy||stopped||!enabled)return Promise.resolve({skipped:true});const running=cycle();inFlight=running;running.finally(()=>{if(inFlight===running)inFlight=null;});return running;}
 async function stop(){
  stopped=true;if(timer!==null)clearTimer(timer);timer=null;
  if(inFlight)await inFlight;
  try{await healthSave(state=>recordSchedulerHeartbeat(state,{owner_id:ownerId,owner:false},clock()));}catch{}
  await dispose(true);
 }
 if(enabled)schedule(5000);
 return{stop,runOnce,get active(){return enabled&&!stopped;},get ownsLock(){return lockValid;}};
}
