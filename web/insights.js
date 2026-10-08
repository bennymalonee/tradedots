(() => {
 const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const money=x=>Number.isFinite(x)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x):'Unavailable';
 const when=x=>x?new Date(x).toLocaleString():'Not recorded';
 const names=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
 let panel,latest,tab='agents',sequence=0,memoryLoaded=false;
 function ensure() {
  if(panel)return panel;
  panel=make('section','','panel insights-panel');panel.id='desk-insights';
  const head=make('div','','panel-head');head.append(make('h2','DESK EVIDENCE & READINESS'));panel.append(head);
  panel.append(make('p','See recorded decisions, retrieve past evidence, check readiness, and compare virtual results.','market-note'));
  const nav=make('div','','insight-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Desk evidence');
  for(const [id,label]of [['agents','Agent activity'],['memory','Memory'],['readiness','Readiness'],['performance','Performance']]) {
   const b=make('button',label);b.id='insight-tab-'+id;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls','insight-'+id);b.onclick=()=>{tab=id;render();if(id==='memory'&&!memoryLoaded)search();window.dispatchEvent(new CustomEvent('desk-tab-selected',{detail:{tab:id}}));};nav.append(b);
   const content=make('div','','insight-content');content.id='insight-'+id;content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby',b.id);panel.append(content);
  }
  nav.addEventListener('keydown',e=>{const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;let next;if(e.key==='ArrowRight')next=(index+1)%buttons.length;else if(e.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=buttons.length-1;else return;e.preventDefault();buttons[next].focus();buttons[next].click();});
  head.after(nav);
  const status=make('p','','market-note');status.id='insight-status';status.setAttribute('role','status');panel.append(status);
  (document.querySelector('#simulation-panel')||document.querySelector('#research-room')||document.querySelector('.markets-panel')).after(panel);
  buildMemory();return panel;
 }
 async function post(path) {
  const status=panel.querySelector('#insight-status');status.textContent='Running recorded evidence checks…';
  try {
   const r=await window.withAgentActivity(names,()=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
   const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');
   status.textContent=path.includes('readiness')?'Readiness report saved. No orders or AI calls were made.':'Archive updated from available history.';
   if(path.includes('readiness')){latest.readiness=data;renderReadiness();}else search();
   window.dispatchEvent(new Event('desk-refresh'));
  }catch(e){status.textContent=e.message;}
 }
 function buildMemory() {
  const root=panel.querySelector('#insight-memory');
  const form=make('form','','memory-search');
  const input=make('input');input.type='search';input.maxLength=200;input.placeholder='Search a symbol, risk, spread, or lesson';input.setAttribute('aria-label','Search archived evidence');
  const agent=make('select');agent.setAttribute('aria-label','Filter memory by agent');for(const name of ['',...names]){const opt=make('option',name||'All agents');opt.value=name;agent.append(opt);}
  const kind=make('select');kind.setAttribute('aria-label','Filter memory by record type');for(const [id,label]of [['','All records'],['research','Research'],['lesson','Trade lessons'],['forecast','Forecast outcomes'],['decision','Decisions'],['fill','Virtual entries']]){const opt=make('option',label);opt.value=id;kind.append(opt);}
  const button=make('button','Search');button.type='submit';form.append(input,agent,kind,button);form.onsubmit=e=>{e.preventDefault();search();};root.append(form);
  const sync=make('button','Archive available history');sync.type='button';sync.onclick=()=>post('/api/memory/sync');root.append(sync,make('p','Full-text and symbol matching. Decisions are retained for 14 days; research, forecasts, and trade lessons remain until the database is removed.','market-note'));
  const results=make('div','','memory-results');results.setAttribute('aria-live','polite');root.append(results);
 }
 async function search() {
  const id=++sequence,form=panel.querySelector('.memory-search'),root=panel.querySelector('.memory-results');
  root.replaceChildren(make('p','Searching archived evidence…'));
  const query=new URLSearchParams({q:form.querySelector('input').value,agent:form.querySelectorAll('select')[0].value,kind:form.querySelectorAll('select')[1].value});
  try {
   const r=await fetch('/api/memory?'+query);const data=await r.json();if(!r.ok)throw Error(data.error||'Search failed');if(id!==sequence)return;memoryLoaded=true;
   root.replaceChildren(make('p',`${data.results.length} matches shown · ${data.count} archived records. Up to 30 matches per search.`));
   if(!data.results.length)root.append(make('p','No matches yet. Archive available history, wait for recorded tasks, or try another search.'));
   for(const doc of data.results){const card=make('article','','record memory-record');card.append(make('b',doc.title),make('small',`${doc.kind} · ${when(doc.at)} · ${doc.symbol||'Workflow'}`),make('p',doc.text));const details=make('details');details.append(make('summary','Evidence and recorded outcome'),make('pre',JSON.stringify(doc.evidence,null,2)));card.append(details);root.append(card);}
  }catch(e){if(id===sequence)root.replaceChildren(make('p',e.message));}
 }
 function renderAgents() {
  const root=panel.querySelector('#insight-agents');root.replaceChildren();
  for(const a of latest.agents||[]){const card=make('article','','insight-agent');card.append(make('h3',a.name+' · '+a.status.replaceAll('_',' ')),make('p',a.reason),make('small','Last recorded task: '+when(a.last_at)));
   const details=make('details');details.append(make('summary','Task evidence and recent reviews'));
   for(const c of a.decisions||[]){const row=make('div','','record');row.append(make('b',`${c.symbol||'Desk'} · ${c.stage} · ${c.pass?'PASS':'WAIT / VETO'}`),make('small',when(c.at)),make('p',c.reason),make('pre',JSON.stringify(c.evidence||{},null,2)));details.append(row);}
   for(const r of a.reviews||[]){const row=make('div','','record');row.append(make('b',`${r.mode.toUpperCase()} · ${r.symbol||'Workflow'} · ${r.status}`),make('p',r.summary),make('small','Citations: '+(r.citations||[]).join(', ')),make('small',r.outcome?'Recorded outcome: '+JSON.stringify(r.outcome):'No scored outcome yet'));details.append(row);}
   if(!a.decisions?.length&&!a.reviews?.length)details.append(make('p','No recorded tasks yet. Health labels do not indicate active work.'));card.append(details);root.append(card);}
 }
 function renderReadiness() {
  const root=panel.querySelector('#insight-readiness');root.replaceChildren();
  const b=make('button','Run readiness checks');b.type='button';b.onclick=()=>post('/api/readiness');root.append(b);
  const report=latest.readiness;
  if(!report){root.append(make('p','Run isolated functional checks and inspect current data, agent history, and configuration. This does not contact providers or place trades.'));return;}
  root.append(make('h3',report.status.replaceAll('_',' ').toUpperCase()),make('small',when(report.at)),make('p','This is a saved snapshot. Rerun after changing configuration or collecting new evidence.','market-note'));
  for(const c of report.checks){const row=make('div','','record readiness-'+c.status);row.append(make('b',c.status.toUpperCase()+' · '+c.id.replaceAll('_',' ')),make('p',c.detail));root.append(row);}
  const details=make('details');details.append(make('summary','Synthetic simulation results'),make('pre',JSON.stringify(report.synthetic.checks,null,2)));root.append(details,make('p',report.scope,'market-note'));
 }
 function renderPerformance() {
  const root=panel.querySelector('#insight-performance'),p=latest.performance;root.replaceChildren();if(!p)return;
  root.append(make('h3',p.status.replaceAll('_',' ').toUpperCase()),make('p',p.reason),make('p','Adaptive minus baseline net P&L: '+money(p.net_advantage)));
  if(p.accounts){const table=make('table','','performance-table');const header=make('tr');for(const v of ['Metric','Adaptive','Baseline'])header.append(make('th',v));const thead=make('thead');thead.append(header);table.append(thead);const body=make('tbody');
   const metrics=[['Total marked net P&L','net_pnl',money],['Realized net P&L','realized_net_pnl',money],['Unrealized marked net P&L','unrealized_net_pnl',money],['Return','return_pct',x=>Number.isFinite(x)?x.toFixed(2)+'%':'Unavailable'],['Modeled fees','fees',money],['Closed trades','closed_trades',String],['Mean realized net per trade','mean_trade_net',money],['Win rate','win_rate',x=>Number.isFinite(x)?x.toFixed(1)+'%':'Unavailable'],['Profit factor','profit_factor',x=>Number.isFinite(x)?x.toFixed(2):'No loss denominator'],['Sampled max drawdown','max_drawdown_pct',x=>x.toFixed(2)+'%'],['Open positions','open_positions',String]];
   for(const [label,key,format]of metrics){const row=make('tr');row.append(make('th',label),make('td',format(p.accounts.adaptive[key])),make('td',format(p.accounts.baseline[key])));body.append(row);}table.append(body);root.append(table);}
  const chart=equityChart(p.curve||[]);if(chart)root.append(chart);
  root.append(make('p',p.assumptions||'Awaiting a simulation cycle.','market-note'));
 }
 function equityChart(curve) {
  const rows=curve.filter(p=>Number.isFinite(p.at)),values=rows.flatMap(p=>[p.adaptive_equity,p.baseline_equity]).filter(Number.isFinite);
  if(rows.length<2||!values.length)return null;
  const low=Math.min(...values)-1,high=Math.max(...values)+1,start=rows[0].at,end=rows.at(-1).at;if(start===end)return null;
  const x=t=>58+(t-start)/(end-start)*560,y=v=>150-(v-low)/(high-low)*120;
  const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const wrapper=make('figure','','equity-chart'),caption=make('figcaption','Recent sampled equity · adaptive mint / baseline gold. Gaps indicate unavailable marks.');wrapper.append(caption);
  const svg=svgNode('svg',{viewBox:'0 0 640 190',role:'img','aria-label':'Recent adaptive and baseline virtual equity in US dollars'});
  for(const value of [low,high]){svg.append(svgNode('line',{x1:58,x2:618,y1:y(value),y2:y(value),stroke:'#6a582b'}));const text=svgNode('text',{x:4,y:y(value)+4,fill:'#d3c99f','font-size':10});text.textContent=money(value);svg.append(text);}
  for(const [key,color]of [['adaptive_equity','#a9f3cd'],['baseline_equity','#e6c76d']]){let segment=[];const flush=()=>{if(segment.length>1)svg.append(svgNode('polyline',{points:segment.join(' '),fill:'none',stroke:color,'stroke-width':2}));segment=[];};
   for(const p of rows){if(!Number.isFinite(p[key])){flush();continue;}segment.push(x(p.at)+','+y(p[key]));const dot=svgNode('circle',{cx:x(p.at),cy:y(p[key]),r:2,fill:color});const title=svgNode('title');title.textContent=key.replace('_equity','')+' · '+when(p.at)+' · '+money(p[key]);dot.append(title);svg.append(dot);}flush();}
  for(const [at,align,position]of [[start,'start',58],[end,'end',618]]){const label=svgNode('text',{x:position,y:180,fill:'#d3c99f','font-size':10,'text-anchor':align});label.textContent=new Date(at).toLocaleTimeString();svg.append(label);}
  wrapper.append(svg);return wrapper;
 }
 function render() {
  if(!latest)return;ensure();
  for(const id of ['agents','memory','readiness','performance']){panel.querySelector('#insight-'+id).hidden=tab!==id;panel.querySelector('#insight-tab-'+id).setAttribute('aria-selected',String(tab===id));}
  renderAgents();renderReadiness();renderPerformance();
 }
 window.addEventListener('desk-data',e=>{if(!e.detail.insights)return;latest=e.detail.insights;render();});
 window.addEventListener('desk-navigate',e=>{if(!latest||!['agents','memory','readiness','performance'].includes(e.detail?.tab))return;tab=e.detail.tab;render();if(tab==='memory'&&!memoryLoaded)search();});
 if(window.dotsDeskData?.insights){latest=window.dotsDeskData.insights;render();}
})();
