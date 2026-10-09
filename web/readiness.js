(() => {
 const node=(tag,text='',cls='')=>{const element=document.createElement(tag);element.textContent=text;if(cls)element.className=cls;return element;};
 let latest=null,refreshRequested=false;
 const panel=node('section','','panel testing-readiness');panel.id='testing-readiness';panel.setAttribute('aria-labelledby','testing-readiness-title');
 const header=node('div','','panel-head'),title=node('h2','PAPER TESTING / GUIDED SETUP');title.id='testing-readiness-title';header.append(title,node('span','ONE COMPLETE TEST CYCLE'));panel.append(header);
 const intro=node('div','','testing-readiness-intro'),introCopy=node('div'),summary=node('h3','Checking your testing setup…'),explanation=node('p','The desk will show what is ready and the next step when its cached status arrives.','testing-readiness-note'),nextRoot=node('div','','testing-readiness-next');introCopy.append(summary,explanation);intro.append(introCopy,nextRoot);panel.append(intro);
 const progress=node('div','','testing-readiness-progress'),progressLabel=node('span','Waiting for desk status'),progressTrack=node('div','','testing-readiness-progress-track'),progressFill=node('span');progressTrack.setAttribute('aria-hidden','true');progressTrack.append(progressFill);progress.append(progressLabel,progressTrack);panel.append(progress);
 const stepsRoot=node('ol','','testing-readiness-steps');stepsRoot.setAttribute('aria-label','Paper test setup steps');panel.append(stepsRoot);
 const monitoringRoot=node('div','','testing-readiness-monitoring');panel.append(monitoringRoot);
 const help=node('details','','testing-readiness-help'),helpTitle=node('summary','How monitoring keeps this test moving'),helpBody=node('div');help.append(helpTitle,helpBody);panel.append(help);
 panel.append(node('p','This screen checks existing desk status. Opening it makes no AI calls and submits no orders. An AI round is started separately in Research Room; API usage charges apply there.','testing-readiness-note testing-readiness-footer'));
 const status=node('p','','testing-readiness-action-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(status);
 const mount=document.querySelector('.markets-panel');if(mount)mount.before(panel);else(document.querySelector('main')||document.body).append(panel);

 function timestamp(value){const time=typeof value==='number'?value:Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString():'Not recorded';}
 function age(value){if(!Number.isFinite(value))return'Not recorded';if(value<60)return Math.max(0,Math.floor(value))+' seconds ago';if(value<3600)return Math.floor(value/60)+' minutes ago';return(Math.floor(value/3600))+' hours ago';}
 function safeHref(value){if(typeof value!=='string'||!value)return null;try{const url=new URL(value,location.href);return url.origin===location.origin&&['http:','https:'].includes(url.protocol)?value:null;}catch{return null;}}
 function openHelp(){help.open=true;help.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});helpTitle.focus();}
 function openSetup(){const setup=document.querySelector('.api-setup-access button');if(setup?.disabled){status.textContent='Wait for the current research action to finish before opening API setup.';return;}if(setup){setup.click();status.textContent='Secure OpenAI API setup opened. Saving a key is a separate action.';}else{const room=document.querySelector('#research-room');if(room){room.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});status.textContent='Open API SETUP in Research Room once its connection controls load.';}else status.textContent='Waiting for Research Room to load its API setup controls.';}}
 function control(action,key){if(!action)return null;const kind=typeof action==='string'?action:action.kind,label=action.label||'Continue',href=safeHref(action.href);
  if(['agent_lab','research'].includes(kind)||href){const link=node('a',label,'testing-readiness-control');link.href=href||(kind==='agent_lab'?'#agent-lab':'#research-room');link.dataset.readinessControl=key;return link;}
  if(!['api_setup','refresh','monitor_help'].includes(kind))return null;
  const button=node('button',label,'testing-readiness-control');button.type='button';button.dataset.readinessControl=key;
  button.onclick=()=>{if(kind==='api_setup')openSetup();else if(kind==='monitor_help')openHelp();else{refreshRequested=true;status.textContent='Requesting a monitoring update…';window.dispatchEvent(new Event('desk-refresh'));}};
  return button;
 }
 function resolveNext(){const next=latest?.next_action;if(!next)return null;const step=(latest.steps||[]).find(item=>item.id===next.id),value=next.action;if(typeof value==='object'&&value)return{...value,label:next.label||value.label,href:next.href||value.href};if(typeof value==='string')return{kind:value,label:next.label,href:next.href};if(step?.action)return{...step.action,label:next.label||step.action.label,href:next.href||step.action.href};return next.href?{kind:'research',label:next.label,href:next.href}:null;}
 function renderMonitoring(){monitoringRoot.replaceChildren();const monitor=latest?.monitoring;if(!monitor){helpBody.replaceChildren(node('p','Monitoring status will appear when desk data loads.','testing-readiness-note'));return;}
  const browser=monitor.mode==='browser'||monitor.mode==='browser_only'||String(monitor.runtime||'').toLowerCase().includes('sites'),heading=node('div','','testing-readiness-monitor-heading');heading.append(node('h4','Monitoring heartbeat'),node('span',String(monitor.status||'waiting').replaceAll('_',' '),'testing-readiness-chip'));monitoringRoot.append(heading);
  const metrics=node('dl','','testing-readiness-monitor-metrics');for(const [label,value]of [['Coverage',monitor.background_ready?'Background monitor available':browser?'Keep this browser tab open':'Background monitor unavailable'],['Last successful cycle',timestamp(monitor.last_success_at)],['Last tick',age(monitor.last_tick_age_seconds)],['Target interval',Number.isFinite(monitor.interval_seconds)?monitor.interval_seconds+' seconds':'Not configured']]){const item=node('div');item.append(node('dt',label),node('dd',value));metrics.append(item);}monitoringRoot.append(metrics);
  if(monitor.consecutive_failures>0)monitoringRoot.append(node('p',`${monitor.consecutive_failures} consecutive monitoring failure${monitor.consecutive_failures===1?'':'s'}${monitor.last_failure_at?' · last failure '+timestamp(monitor.last_failure_at):''}.`,'testing-readiness-monitor-warning'));
  if(monitor.note)monitoringRoot.append(node('p',monitor.note,'testing-readiness-note'));
  helpBody.replaceChildren();
  if(browser){helpBody.append(node('p','For a browser-monitored test, keep this dashboard tab open and visible with monitoring running. Background or closed tabs can pause updates. Use Refresh monitoring below to request a new cycle.','testing-readiness-note'),node('p','Paper entries need a fresh quote after the AI round finishes. A slow hourly update can miss the ten-minute entry window; a later valid quote is also needed to close a paper pair.','testing-readiness-note'));}
  else if(!monitor.background_ready){helpBody.append(node('p','For continuous monitoring on your VPS, set MONITOR_ENABLED=true in the app’s Coolify environment and redeploy. The default interval is 60 seconds; MONITOR_INTERVAL_SECONDS cannot be shorter than 60 seconds.','testing-readiness-note'),node('p','Then check that the heartbeat advances while the dashboard is closed. Until the background monitor is verified, keep this dashboard open and visible during a test.','testing-readiness-note'));}
  else{helpBody.append(node('p','The background monitor can collect quotes without this dashboard open. Verify that the last successful cycle continues to advance. A stale heartbeat or repeated failures means the experiment may wait for quotes.','testing-readiness-note'));}
  helpBody.append(node('p','Starting an experiment waits for new AI reports. It does not start an AI round or enable scheduled paid research. Open Research Room separately to run the first round.','testing-readiness-note'));
  const refresh=control({kind:'refresh',label:'Refresh monitoring'},'help-refresh');if(refresh)helpBody.append(refresh);
 }
 function render(){const focused=panel.contains(document.activeElement)?document.activeElement.dataset.readinessControl:null;
  nextRoot.replaceChildren();stepsRoot.replaceChildren();if(!latest){renderMonitoring();return;}
  const steps=Array.isArray(latest.steps)?latest.steps:[],passed=steps.filter(step=>step.status==='pass').length;
  const labels={ready:'Ready for a paper test',needs_attention:'Finish your paper test setup',blocked:'Your paper test needs attention'};summary.textContent=labels[latest.status]||'Check your paper test setup';panel.dataset.readinessStatus=latest.status||'needs_attention';
  explanation.textContent=latest.status==='ready'?'The required setup checks passed. Run a new AI round, then watch Agent lab for later quote observations and paper outcomes.':'Follow the next available step below. The desk keeps missing setup and delayed observations visible.';
  progressLabel.textContent=`${passed} of ${steps.length} setup steps ready`;progressFill.style.width=steps.length?(passed/steps.length*100)+'%':'0%';
  const next=control(resolveNext(),'next');if(next)nextRoot.append(node('small','NEXT STEP'),next);
  for(const [index,step]of steps.entries()){const item=node('li','','testing-readiness-step'),state=['pass','waiting','blocked'].includes(step.status)?step.status:'waiting';item.dataset.stepStatus=state;item.dataset.readinessStep=step.id||String(index);
   const marker=node('span',state==='pass'?'✓':String(index+1),'testing-readiness-step-marker');marker.setAttribute('aria-hidden','true');const body=node('div','','testing-readiness-step-copy'),row=node('div','','testing-readiness-step-heading');row.append(node('h4',step.title||'Setup step'),node('span',state==='pass'?'Ready':state==='blocked'?'Needs attention':'Waiting','testing-readiness-chip'));body.append(row,node('p',step.detail||'Awaiting this check.','testing-readiness-note'));const action=control(step.action,'step-'+(step.id||index));if(action&&state!=='pass')body.append(action);item.append(marker,body);stepsRoot.append(item);
  }
  renderMonitoring();if(refreshRequested){status.textContent='Monitoring status updated. Check the heartbeat and setup steps above.';refreshRequested=false;}
  if(focused){const target=[...panel.querySelectorAll('[data-readiness-control]')].find(element=>element.dataset.readinessControl===focused);if(target)target.focus({preventScroll:true});}
 }
 window.addEventListener('desk-data',event=>{if(event.detail?.testing_readiness){latest=event.detail.testing_readiness;render();}});
 if(window.dotsDeskData?.testing_readiness)latest=window.dotsDeskData.testing_readiness;render();
})();
