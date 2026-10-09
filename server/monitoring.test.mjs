import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {initialState} from '../worker/paper.mjs';
import {monitoringSummary,configureMonitoringScheduler,recordSchedulerHeartbeat,recordSchedulerFailure,recordMonitoringAttempt,recordMonitoringSuccess,recordMonitoringFailure,updateMonitoringHealth} from '../worker/monitoring.mjs';
import {createMonitoringScheduler} from './scheduler.mjs';

const epoch=1_800_000_000_000;
const vps={MONITOR_RUNTIME:'vps',MONITOR_ENABLED:'true',MONITOR_INTERVAL_SECONDS:'60'};
test('stalled scheduler produces one bounded incident and one recovery, never fake browser recovery',()=>{
 const state=initialState(epoch);configureMonitoringScheduler(state,{enabled:true,interval_seconds:60},epoch);recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch);recordMonitoringAttempt(state,{actor:'scheduler'},epoch);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch);
 assert.equal(monitoringSummary(state,vps,epoch).background_ready,false);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch+60000);
 assert.equal(updateMonitoringHealth(state,vps,epoch+60000).status,'healthy');assert.equal(monitoringSummary(state,vps,epoch+60000).background_ready,true);
 assert.equal(updateMonitoringHealth(state,vps,epoch+181000).status,'stalled');updateMonitoringHealth(state,vps,epoch+240000);assert.equal(state.alerts.filter(a=>a.type==='monitoring_stalled').length,1);
 recordMonitoringSuccess(state,{actor:'browser',quotes:4},epoch+240000);updateMonitoringHealth(state,vps,epoch+240000);assert.equal(state.alerts[0].resolved_at,undefined);
 recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch+241000);updateMonitoringHealth(state,vps,epoch+241000);assert.equal(state.alerts[0].resolved_at,undefined);
 recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch+242000);assert.equal(updateMonitoringHealth(state,vps,epoch+242000).status,'healthy');updateMonitoringHealth(state,vps,epoch+243000);assert.equal(state.alerts.filter(a=>a.type==='monitoring_recovered').length,1);assert.equal(state.alerts.find(a=>a.type==='monitoring_stalled').resolved_at,epoch+242000);
 assert.deepEqual([state.cash_cents,state.ledger.length,state.positions.length],[100000,0,0]);
});
test('background experiment readiness measures real cadence rather than configured timer or skipped ticks',()=>{
 const state=initialState(epoch);configureMonitoringScheduler(state,{enabled:true,interval_seconds:60},epoch);recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch);
 assert.equal(monitoringSummary(state,vps,epoch).background_ready,false);recordMonitoringSuccess(state,{actor:'scheduler',skipped:true},epoch+60000);assert.equal(monitoringSummary(state,vps,epoch+60000).background_ready,false);
 recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch+180000);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch+180000);assert.equal(monitoringSummary(state,vps,epoch+180000).background_ready,false);assert.equal(monitoringSummary(state,vps,epoch+180000).observed_interval_seconds,180);
 recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch+240000);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch+240000);assert.equal(monitoringSummary(state,vps,epoch+240000).background_ready,true);
});
test('disabled and Sites runtime never advertise a background scheduler; actual browser cadence requires two real collections',()=>{
 const state=initialState(epoch);configureMonitoringScheduler(state,{enabled:true},epoch);recordSchedulerHeartbeat(state,{owner_id:'fixture-owner'},epoch);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch);
 assert.equal(monitoringSummary(state,{...vps,MONITOR_ENABLED:'false'},epoch).status,'disabled');assert.equal(monitoringSummary(state,{...vps,MONITOR_ENABLED:'false'},epoch).background_ready,false);
 let summary=monitoringSummary(state,{},epoch);assert.equal(summary.mode,'browser');assert.equal(summary.owner,false);assert.equal(summary.background_ready,false);assert.equal(summary.browser_ready,false);
 state.last_tick=epoch;assert.equal(monitoringSummary(state,{},epoch+1000).status,'browser_active');assert.equal(monitoringSummary(state,{},epoch+1000).browser_ready,false);
 recordMonitoringSuccess(state,{actor:'browser',quotes:4},epoch+1000);recordMonitoringSuccess(state,{actor:'browser',skipped:true},epoch+61000);assert.equal(monitoringSummary(state,{},epoch+61000).browser_ready,false);
 recordMonitoringSuccess(state,{actor:'browser',quotes:4},epoch+61000);summary=monitoringSummary(state,{},epoch+62000);assert.equal(summary.browser_ready,true);assert.equal(summary.browser.observed_interval_seconds,60);assert.equal(summary.browser.counters.successes,2);assert.equal(summary.browser.counters.skipped,1);
 assert.equal(monitoringSummary(state,{},epoch+212000).browser_ready,false);assert.equal(monitoringSummary(state,{},epoch+212000).status,'browser_stale');
});
test('monitoring failure counters are bounded, skipped collections do not reset failure or last success, and output is sanitized',()=>{
 const state=initialState(epoch);recordMonitoringAttempt(state,{actor:'scheduler',token:'secret-fixture-token'},epoch);recordMonitoringSuccess(state,{actor:'scheduler',quotes:10},epoch);recordMonitoringFailure(state,{actor:'scheduler',error:'secret-fixture-error'},epoch+1000);recordMonitoringSuccess(state,{actor:'scheduler',skipped:true,quotes:1000},epoch+2000);
 state.monitoring.scheduler.api_key='secret-fixture-key';state.monitoring.scheduler.counters.failures=Infinity;
 const summary=monitoringSummary(state,vps,epoch+3000);assert.equal(summary.last_success_at,epoch);assert.equal(summary.last_quotes,10);assert.equal(summary.consecutive_failures,1);assert.equal(summary.counters.skipped,1);assert.equal(summary.counters.failures,0);assert.ok(!JSON.stringify(summary).includes('secret-fixture'));assert.ok(!JSON.stringify(state).includes('secret-fixture-token'));assert.ok(!JSON.stringify(state).includes('secret-fixture-error'));
});
test('only the recorded owner may clear scheduler ownership, and long intervals fail minute readiness',()=>{
 const state=initialState(epoch);configureMonitoringScheduler(state,{enabled:true,interval_seconds:600},epoch);recordSchedulerHeartbeat(state,{owner_id:'owner-A'},epoch);recordMonitoringSuccess(state,{actor:'scheduler',quotes:4},epoch);
 assert.equal(recordSchedulerFailure(state,{owner_id:'owner-B'},epoch+1000),false);assert.equal(state.monitoring.scheduler.owner,true);assert.equal(monitoringSummary(state,{...vps,MONITOR_INTERVAL_SECONDS:'600'},epoch+1000).background_ready,false);
 assert.equal(recordSchedulerFailure(state,{owner_id:'owner-A'},epoch+1000),true);assert.equal(state.monitoring.scheduler.owner,false);assert.equal(state.monitoring.scheduler.failure_code,'scheduler_connection_lost');
});

function schedulerFixture({enabled=true,refresh=async()=>({orders_submitted:0})}={}){
 let at=epoch,nextTimer=1,owner=null;const state=initialState(epoch),timers=new Map(),clients=[],calls=[];
 class Client extends EventEmitter{
  constructor(){super();this.alive=true;this.releases=[];this.failLockCheck=false;clients.push(this);}
  async query(sql){calls.push(sql);if(!this.alive)throw Error('fixture-only database credential must not be logged');
   if(sql.includes('pg_try_advisory_lock')){const acquired=owner===null||owner===this;if(acquired)owner=this;return{rows:[{acquired}]};}
   if(sql.includes('pg_locks'))return{rows:[{acquired:owner===this&&!this.failLockCheck}]};
   if(sql.includes('pg_advisory_unlock')){if(owner===this)owner=null;return{rows:[{pg_advisory_unlock:true}]};}
   throw Error('Unexpected scheduler SQL');
  }
  release(destroy=false){this.releases.push(destroy);if(destroy){this.alive=false;if(owner===this)owner=null;}}
  drop(){this.alive=false;if(owner===this)owner=null;this.emit('error',Error('fixture-only secret connection detail'));}
 }
 const config={pool:{async connect(){return new Client();}},env:{...vps,MONITOR_ENABLED:enabled?'true':'false'},refresh,clock:()=>at,persist:async operation=>({state,result:operation(state)}),setTimer:(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id),log:message=>calls.push(message)};
 return{state,timers,clients,calls,config,setNow:value=>{at=value;},get owner(){return owner;}};
}
test('disabled scheduler does not connect to PostgreSQL or schedule refreshes',async()=>{
 const fixture=schedulerFixture({enabled:false,refresh:async()=>{throw Error('Should not refresh');}}),scheduler=await createMonitoringScheduler(fixture.config);
 assert.equal(scheduler.active,false);assert.equal(fixture.clients.length,0);assert.equal(fixture.timers.size,0);await scheduler.runOnce();await scheduler.stop();assert.equal(fixture.clients.length,0);
});
test('scheduler awaits collection and never overlaps; next due is based on completion and shutdown waits before unlocking',async()=>{
 let resolve,count=0,seenOptions;const fixture=schedulerFixture({refresh:async(env,options)=>{count++;seenOptions=options;return new Promise(done=>{resolve=done;});}}),scheduler=await createMonitoringScheduler(fixture.config);
 const first=scheduler.runOnce();await new Promise(done=>setImmediate(done));assert.equal(count,1);assert.deepEqual(seenOptions,{actor:'scheduler'});assert.equal((await scheduler.runOnce()).skipped,true);assert.equal(count,1);assert.equal(fixture.state.monitoring.scheduler.in_flight,true);
 let stopped=false;const stopping=scheduler.stop().then(()=>{stopped=true;});await new Promise(done=>setImmediate(done));assert.equal(stopped,false);assert.ok(fixture.owner);
 fixture.setNow(epoch+90000);resolve({orders_submitted:0});await first;await stopping;assert.equal(stopped,true);assert.equal(fixture.timers.size,0);assert.equal(fixture.owner,null);assert.deepEqual(fixture.clients[0].releases,[false]);assert.equal(fixture.state.monitoring.scheduler.owner,false);
});
test('sequential timer schedules one configured delay after completion',async()=>{
 const fixture=schedulerFixture({refresh:async()=>{fixture.setNow(epoch+90000);return{orders_submitted:0};}}),scheduler=await createMonitoringScheduler(fixture.config);
 assert.equal([...fixture.timers.values()][0].delay,5000);await scheduler.runOnce();assert.equal(fixture.timers.size,1);assert.equal([...fixture.timers.values()][0].delay,60000);assert.equal(fixture.state.monitoring.scheduler.next_due_at,epoch+150000);await scheduler.stop();
});
test('waiting replicas preserve active owner and take over on the next retry after release',async()=>{
 let calls=0;const fixture=schedulerFixture({refresh:async()=>{calls++;return{orders_submitted:0};}}),first=await createMonitoringScheduler(fixture.config),second=await createMonitoringScheduler(fixture.config);
 await first.runOnce();const ownerId=fixture.state.monitoring.scheduler.owner_id;assert.equal((await second.runOnce()).waiting_for_owner,true);assert.equal(calls,1);assert.equal(fixture.state.monitoring.scheduler.owner_id,ownerId);await first.stop();await second.runOnce();assert.equal(calls,2);assert.notEqual(fixture.state.monitoring.scheduler.owner_id,ownerId);await second.stop();
});
test('lost advisory lock prevents collection, destroys the session, and retries with a fresh lock owner',async()=>{
 let calls=0;const fixture=schedulerFixture({refresh:async()=>{calls++;return{orders_submitted:0};}}),scheduler=await createMonitoringScheduler(fixture.config);
 await scheduler.runOnce();fixture.clients[0].failLockCheck=true;const lost=await scheduler.runOnce();assert.equal(lost.ownership_lost,true);assert.equal(calls,1);assert.equal(fixture.state.monitoring.scheduler.owner,false);assert.deepEqual(fixture.clients[0].releases,[true]);await scheduler.runOnce();assert.equal(calls,2);assert.equal(fixture.clients.length,2);assert.equal(scheduler.ownsLock,true);await scheduler.stop();
});
test('idle PostgreSQL errors cannot crash scheduler or reuse a failed connection, and logs contain no database detail',async()=>{
 let calls=0;const fixture=schedulerFixture({refresh:async()=>{calls++;return{orders_submitted:0};}}),scheduler=await createMonitoringScheduler(fixture.config);
 await scheduler.runOnce();fixture.clients[0].drop();assert.equal(scheduler.ownsLock,false);assert.equal(fixture.state.monitoring.scheduler.owner,false);assert.equal(monitoringSummary(fixture.state,vps,epoch).background_ready,false);await scheduler.runOnce();assert.equal(fixture.clients.length,2);assert.deepEqual(fixture.clients[0].releases,[true]);assert.equal(calls,2);assert.ok(!fixture.calls.some(message=>message.includes('secret connection detail')));await scheduler.stop();
});
