(() => {
 let latest=null,busy=false;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 async function run(mode){
  if(busy)return;busy=true;
  const panel=document.querySelector('#research-room'),status=panel.querySelector('.research-action');
  panel.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=mode==='preview'?'Checking the free research workflow…':'Running six sequential AI reviews…';
  try{const result=await window.withAgentActivity(['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'],async()=>{const response=await fetch(mode==='preview'?'/api/research/preview':'/api/research/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intent_id:crypto.randomUUID(),scenario:panel.querySelector('textarea').value})});const value=await response.json();if(!response.ok)throw Error(value.error||'Research request failed');return value});status.textContent=(result.message||result.error||'Research '+result.status)+'. No order was submitted.';window.dispatchEvent(new Event('desk-refresh'));}
  catch(error){status.textContent=error.message;}finally{busy=false;panel.querySelector('[data-preview]').disabled=false;panel.querySelector('[data-ai]').disabled=!latest?.configured;panel.querySelector('[data-save]').disabled=false;}
 }
 window.addEventListener('desk-data',event=>{
  const lab=event.detail.research;if(!lab)return;latest=lab;
  let panel=document.querySelector('#research-room');
  if(!panel){panel=node('section','','panel research-room');panel.id='research-room';
   const header=node('div','','panel-head');header.append(node('h2','SIX-AGENT RESEARCH ROOM'),node('span','MEMORY · CHALLENGE · EVALUATION'));panel.append(header,node('p','','research-connection market-note'));
   const scenario=node('label','Hypothetical scenario to explore','research-scenario');const area=document.createElement('textarea');area.rows=3;area.maxLength=3000;area.placeholder='Example: How would a volatility spike challenge the current bullish case?';scenario.append(area);panel.append(scenario);
   const controls=node('div','','sim-controls');const preview=node('button','PREVIEW WORKFLOW · FREE');preview.dataset.preview='';preview.onclick=()=>run('preview');const ai=node('button','RUN AI RESEARCH');ai.dataset.ai='';ai.onclick=()=>run('ai');controls.append(preview,ai);panel.append(controls);
   const form=document.createElement('form');form.className='research-controls';const enabledLabel=node('label','');const enable=document.createElement('input');enable.type='checkbox';enable.name='enabled';enabledLabel.append(enable,document.createTextNode(' Allow scheduled AI research (provider charges apply)'));form.append(enabledLabel);
   const capLabel=node('label','Maximum AI rounds per day: ');const cap=document.createElement('select');cap.name='cap';for(const n of [1,2,3,4]){const option=node('option',String(n));option.value=n;cap.append(option)}capLabel.append(cap);form.append(capLabel);const save=node('button','SAVE AI USAGE LIMITS');save.type='submit';save.dataset.save='';form.append(save);
   form.onsubmit=async e=>{e.preventDefault();const status=panel.querySelector('.research-action');save.disabled=true;try{const response=await fetch('/api/research/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enable.checked,max_rounds_daily:Number(cap.value)})});const v=await response.json();if(!response.ok)throw Error(v.error||'Could not save controls');status.textContent=v.enabled?'Scheduled AI research enabled within the daily cap.':'Scheduled AI research disabled.';window.dispatchEvent(new Event('desk-refresh'));}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};panel.append(form);
   const status=node('p','','research-action market-note');status.setAttribute('role','status');panel.append(status,node('div','','research-usage'),node('div','','research-reports'),node('p','','research-note market-note'));
   (document.querySelector('#simulation-panel')||document.querySelector('#learning-lab')||document.querySelector('.markets-panel')).after(panel);
  }
  panel.querySelector('.research-connection').textContent=lab.configured?'AI provider configured · '+lab.provider+' / '+lab.model+' · scheduled research '+(lab.enabled?'enabled':'off'):'AI NOT CONNECTED. Open API SETUP to securely connect an OpenAI API key, or copy an evidence packet for manual review using your ChatGPT subscription. The free preview uses no AI API.';
  if(!busy)panel.querySelector('[data-ai]').disabled=!lab.configured;
  const form=panel.querySelector('form');if(document.activeElement!==form.elements.enabled)form.elements.enabled.checked=lab.enabled;if(document.activeElement!==form.elements.cap)form.elements.cap.value=lab.max_rounds_daily;form.elements.enabled.disabled=!lab.configured;
  const usage=panel.querySelector('.research-usage');usage.replaceChildren();for(const [name,value]of [['AI ROUNDS TODAY',lab.usage_today.rounds+'/'+lab.max_rounds_daily],['REPORTED TOKENS',String(lab.usage_today.tokens)],['EVALUATED FORECASTS',String(lab.evaluated)],['MEAN BRIER SCORE',lab.mean_brier===null?'Awaiting outcomes':lab.mean_brier.toFixed(4)]]){const box=node('div','','metric');box.append(node('small',name),node('strong',value));usage.append(box);}
  const reports=panel.querySelector('.research-reports');reports.replaceChildren();
  if(!lab.reports.length)reports.append(node('p','No research rounds yet. Preview the workflow or connect the model provider.'));
  for(const report of lab.reports.slice(0,3)){const article=node('article','','research-report');article.append(node('h3',(report.mode==='ai'?'AI RESEARCH':'PROGRAMMED WORKFLOW PREVIEW')+' · '+report.status.toUpperCase()),node('p',new Date(report.at).toLocaleString()+' · '+(report.symbol||'No fresh quote')+' · no orders executed'));
   if(report.scenario)article.append(node('p','Hypothetical scenario: '+report.scenario));
   const grid=node('div','','research-agents');for(const agent of report.agents){const card=node('div','','research-agent');card.append(node('b',agent.name+' · '+agent.stance.toUpperCase()),node('p',agent.summary),node('small','Challenge: '+agent.challenge),node('small','Evidence: '+(agent.evidence_ids.join(', ')||'None')),node('small','Missing: '+agent.missing.join('; ')));grid.append(card)}article.append(grid);
   if(report.error)article.append(node('p','Round failed: '+report.error));
   if(report.probability_up!==null)article.append(node('p','Experimental mean forecast UP: '+(report.probability_up*100).toFixed(1)+'%. Agent agreement is not independent validation.'));
   if(report.outcome)article.append(node('p','Future-price evaluation: '+report.outcome.status+(report.outcome.brier!==undefined?' · observed '+report.outcome.direction+' · Brier '+report.outcome.brier.toFixed(4):'')));
   else if(report.mode==='ai'&&report.status==='completed')article.append(node('p','Waiting for fresh quotes near '+new Date(report.due_at).toLocaleTimeString()+' to evaluate the one-hour forecast.'));
   reports.append(article);
  }
  panel.querySelector('.research-note').textContent=lab.note+' Daily limits reset at midnight in Europe/Stockholm. Scheduled rounds run at most hourly, within the selected daily cap. Memory stores recent reports and observed outcomes; this does not retrain model weights.';
 });
})();
