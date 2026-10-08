(() => {
 const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const money=x=>Number.isFinite(x)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x):'Unavailable';
 const when=x=>x?new Date(x).toLocaleString():'Not recorded';
 const names=['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'];
 const tabs=[['agents','Agent activity'],['memory','Memory'],['readiness','Readiness'],['performance','Performance'],['validation','Validation']];
 const pendingActions=new Set();
 let panel,latest,tab='agents',sequence=0,memoryLoaded=false;
 function ensure() {
  if(panel)return panel;
  panel=make('section','','panel insights-panel');panel.id='desk-insights';
  const head=make('div','','panel-head');head.append(make('h2','DESK EVIDENCE & READINESS'));panel.append(head);
  panel.append(make('p','See recorded decisions, retrieve past evidence, check readiness, and validate virtual results on later data.','market-note'));
  const nav=make('div','','insight-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Desk evidence');
  for(const [id,label]of tabs) {
   const b=make('button',label);b.id='insight-tab-'+id;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls','insight-'+id);b.onclick=()=>{tab=id;render();if(id==='memory'&&!memoryLoaded)search();window.dispatchEvent(new CustomEvent('desk-tab-selected',{detail:{tab:id}}));};nav.append(b);
   const content=make('div','','insight-content');content.id='insight-'+id;content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby',b.id);content.tabIndex=0;panel.append(content);
  }
  nav.addEventListener('keydown',e=>{const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;let next;if(e.key==='ArrowRight')next=(index+1)%buttons.length;else if(e.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=buttons.length-1;else return;e.preventDefault();buttons[next].focus();buttons[next].click();});
  head.after(nav);
  const status=make('p','','market-note');status.id='insight-status';status.setAttribute('role','status');panel.append(status);
  (document.querySelector('#simulation-panel')||document.querySelector('#research-room')||document.querySelector('.markets-panel')).after(panel);
  buildMemory();return panel;
 }
 async function post(path) {
  if(pendingActions.has(path))return;
  pendingActions.add(path);for(const button of panel.querySelectorAll('button[data-action]'))if(button.dataset.action===path)button.disabled=true;
  const status=panel.querySelector('#insight-status');status.textContent=path==='/api/evaluation'?'Evaluating recorded price history…':path==='/api/memory/sync'?'Archiving available recorded history…':'Running recorded evidence checks…';
  try {
   const request=()=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const r=await (typeof window.withAgentActivity==='function'?window.withAgentActivity(names,request):request());
   const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');
   if(path==='/api/readiness'){status.textContent='Readiness report saved. No orders or AI calls were made.';latest.readiness=data;renderReadiness();}
   else if(path==='/api/evaluation'){status.textContent='Validation report saved. No provider requests or broker orders were made.';latest.validation=data;renderValidation();}
   else{status.textContent='Archive updated from available history.';search();}
   window.dispatchEvent(new Event('desk-refresh'));
  }catch(e){status.textContent=e.message;}finally{pendingActions.delete(path);for(const button of panel.querySelectorAll('button[data-action]'))if(button.dataset.action===path)button.disabled=false;}
 }
 function actionButton(label,path){const b=make('button',label);b.type='button';b.dataset.action=path;b.disabled=pendingActions.has(path);b.onclick=()=>post(path);return b;}
 function tableWrap(table,label){const wrap=make('div','','insight-table-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',label);wrap.append(table);return wrap;}
 function buildMemory() {
  const root=panel.querySelector('#insight-memory');
  const form=make('form','','memory-search');
  const input=make('input');input.type='search';input.maxLength=200;input.placeholder='Search a symbol, risk, spread, or lesson';input.setAttribute('aria-label','Search archived evidence');
  const agent=make('select');agent.setAttribute('aria-label','Filter memory by agent');for(const name of ['',...names]){const opt=make('option',name||'All agents');opt.value=name;agent.append(opt);}
  const kind=make('select');kind.setAttribute('aria-label','Filter memory by record type');for(const [id,label]of [['','All records'],['research','Research'],['lesson','Trade lessons'],['forecast','Forecast outcomes'],['decision','Decisions'],['fill','Virtual entries']]){const opt=make('option',label);opt.value=id;kind.append(opt);}
  const button=make('button','Search');button.type='submit';form.append(input,agent,kind,button);form.onsubmit=e=>{e.preventDefault();search();};root.append(form);
  const sync=actionButton('Archive available history','/api/memory/sync');root.append(sync,make('p','Search archived text and symbols. Decisions are retained for 14 days; research, forecasts, and trade lessons remain until the database is removed.','market-note'));
  const results=make('div','','memory-results');results.setAttribute('aria-live','polite');root.append(results);
 }
 async function search() {
  const id=++sequence,form=panel.querySelector('.memory-search'),root=panel.querySelector('.memory-results');
  root.replaceChildren(make('p','Searching archived evidence…'));
  const query=new URLSearchParams({q:form.querySelector('input').value,agent:form.querySelectorAll('select')[0].value,kind:form.querySelectorAll('select')[1].value});
  try {
   const r=await fetch('/api/memory?'+query);const data=await r.json();if(!r.ok)throw Error(data.error||'Search failed');if(id!==sequence)return;memoryLoaded=true;
   root.replaceChildren(make('p',`${data.results.length} matches shown · ${data.count} archived records. Up to 30 matches per search.`));
   const method=data.search_method||data.method||data.search;if(method)root.append(make('small','Search method: '+String(method).replaceAll('_',' '),'memory-search-method'));
   if(!data.results.length)root.append(make('p','No matches yet. Archive available history, wait for recorded tasks, or try another search.'));
   for(const doc of data.results){const card=make('article','','record memory-record');card.append(make('b',doc.title),make('small',`${doc.kind} · ${when(doc.at)} · ${doc.symbol||'Workflow'}`),make('p',doc.text));const details=make('details');details.append(make('summary','Evidence and recorded outcome'),make('pre',JSON.stringify(doc.evidence,null,2)));card.append(details);root.append(card);}
  }catch(e){if(id===sequence)root.replaceChildren(make('p',e.message));}
 }
 function renderAgents() {
  const root=panel.querySelector('#insight-agents');root.replaceChildren();
  renderLearning(root);
  for(const a of latest.agents||[]){const card=make('article','','insight-agent');card.append(make('h3',a.name+' · '+a.status.replaceAll('_',' ')),make('p',a.reason),make('small','Last recorded task: '+when(a.last_at)));
   const details=make('details');details.append(make('summary','Task evidence and recent reviews'));
   for(const c of a.decisions||[]){const row=make('div','','record');row.append(make('b',`${c.symbol||'Desk'} · ${c.stage} · ${c.pass?'PASS':'WAIT / VETO'}`),make('small',when(c.at)),make('p',c.reason),make('pre',JSON.stringify(c.evidence||{},null,2)));details.append(row);}
   for(const r of a.reviews||[]){const row=make('div','','record');row.append(make('b',`${r.mode.toUpperCase()} · ${r.symbol||'Workflow'} · ${r.status}`),make('p',r.summary),make('small','Citations: '+(r.citations||[]).join(', ')),make('small',r.outcome?'Recorded outcome: '+JSON.stringify(r.outcome):'No scored outcome yet'));
    if(Number.isFinite(r.recalled_memory_count))row.append(make('small','Archived memories supplied: '+r.recalled_memory_count));
    if(Number.isFinite(r.previous_agent_count))row.append(make('small','Earlier agent reviews supplied: '+r.previous_agent_count));
    details.append(row);}
   if(!a.decisions?.length&&!a.reviews?.length)details.append(make('p','No recorded tasks yet. Health labels do not indicate active work.'));card.append(details);root.append(card);}
 }
 function renderLearning(root) {
  const learning=latest.learning;if(!learning)return;
  const scorecard=make('section','','insight-learning-scorecard');scorecard.append(make('h3','Forecast learning scorecard'),make('p',learning.reason));
  const metrics=make('div','','insight-score-grid');
  for(const [label,value]of [['Scored forecasts · all time',String(learning.evaluated??0)],['Recent scored forecasts',String(learning.window_samples??0)],['Brier score · lower is better',Number.isFinite(learning.mean_brier)?learning.mean_brier.toFixed(3):'Awaiting outcomes'],['Neutral 50% forecast',Number.isFinite(learning.neutral_brier)?learning.neutral_brier.toFixed(3):'0.250']]){const cell=make('div');cell.append(make('small',label),make('strong',value));metrics.append(cell);}
  scorecard.append(metrics);
  if(Number.isFinite(learning.brier_skill_pct))scorecard.append(make('p',`Brier skill against neutral: ${learning.brier_skill_pct.toFixed(1)}%. Positive values indicate a lower forecast error in this recorded window.`));
  const details=make('details');details.append(make('summary','Calibration and sample support'));
  const table=make('table','','performance-table insight-calibration-table'),header=make('tr');for(const label of ['Predicted probability','Forecasts','Mean predicted','Observed upward moves','Support'])header.append(make('th',label));const thead=make('thead');thead.append(header);table.append(thead);
  const body=make('tbody'),rate=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'Awaiting outcomes';
  for(const bin of learning.calibration||[]){const row=make('tr');row.append(make('th',bin.range),make('td',String(bin.count)),make('td',rate(bin.mean_probability)),make('td',rate(bin.observed_up_rate)),make('td',bin.sufficient_support?'20+ samples':'Fewer than 20 samples'));body.append(row);}table.append(body);details.append(tableWrap(table,'Forecast calibration by predicted probability'),make('p','Each range needs at least 20 scored forecasts for preliminary support. Overlapping forecasts and changing market conditions limit comparisons.','market-note'));scorecard.append(details,make('p',learning.scope,'market-note'));root.append(scorecard);
 }
 function renderReadiness() {
  const root=panel.querySelector('#insight-readiness');root.replaceChildren();
  root.append(actionButton('Run readiness checks','/api/readiness'));
  const report=latest.readiness;
  if(!report){root.append(make('p','Run isolated functional checks and inspect current data, agent history, and configuration. This does not contact providers or place trades.'));return;}
  root.append(make('h3',report.status.replaceAll('_',' ').toUpperCase()),make('small',when(report.at)),make('p','This is a saved snapshot. Rerun after changing configuration or collecting new evidence. Passing checks does not enable broker execution or establish profitability.','market-note'));
  for(const c of report.checks){const row=make('div','','record readiness-'+c.status);row.append(make('b',c.status.toUpperCase()+' · '+c.id.replaceAll('_',' ')),make('p',c.detail));root.append(row);}
  const details=make('details');details.append(make('summary','Synthetic simulation results'),make('pre',JSON.stringify(report.synthetic.checks,null,2)));root.append(details,make('p',report.scope,'market-note'));
 }
 function renderPerformance() {
  const root=panel.querySelector('#insight-performance'),p=latest.performance;root.replaceChildren();if(!p)return;
  root.append(make('h3',p.status.replaceAll('_',' ').toUpperCase()),make('p',p.reason),make('p','Adaptive minus baseline net P&L: '+money(p.net_advantage)));
  if(p.accounts){const table=make('table','','performance-table');const header=make('tr');for(const v of ['Metric','Adaptive','Baseline'])header.append(make('th',v));const thead=make('thead');thead.append(header);table.append(thead);const body=make('tbody');
   const metrics=[['Total marked net P&L','net_pnl',money],['Realized net P&L','realized_net_pnl',money],['Unrealized marked net P&L','unrealized_net_pnl',money],['Return','return_pct',x=>Number.isFinite(x)?x.toFixed(2)+'%':'Unavailable'],['Modeled fees','fees',money],['Closed trades','closed_trades',String],['Mean realized net per trade','mean_trade_net',money],['Win rate','win_rate',x=>Number.isFinite(x)?x.toFixed(1)+'%':'Unavailable'],['Profit factor','profit_factor',x=>Number.isFinite(x)?x.toFixed(2):'No loss denominator'],['Sampled max drawdown','max_drawdown_pct',x=>Number.isFinite(x)?x.toFixed(2)+'%':'Unavailable'],['Open positions','open_positions',String]];
   for(const [label,key,format]of metrics){const row=make('tr');row.append(make('th',label),make('td',format(p.accounts.adaptive[key])),make('td',format(p.accounts.baseline[key])));body.append(row);}table.append(body);root.append(tableWrap(table,'Virtual adaptive and baseline performance'));}
  const chart=equityChart(p.curve||[]);if(chart)root.append(chart);
  root.append(make('p',p.assumptions||'Awaiting a simulation cycle.','market-note'));
 }
 function renderValidation() {
  const root=panel.querySelector('#insight-validation');root.replaceChildren();root.append(actionButton('Run historical validation','/api/evaluation'));
  root.append(make('p','Uses recorded price history only. Earlier observations select strategy settings; later observations test those fixed settings against a baseline. This makes no provider requests, AI calls, or broker orders.','market-note'));
  const report=latest.validation;
  if(!report){root.append(make('p','No saved validation report yet. Collect price history, then run a test. A run with too few observations will explain what is missing.'));return;}
  root.append(make('h3',String(report.status).replaceAll('_',' ').toUpperCase()),make('small','Saved report: '+when(report.at)));
  const req=report.requirements||{},settings=report.settings||{};
  root.append(make('p',`Minimum per symbol: ${req.min_samples??120} total observations, ${req.min_train_samples??60} training observations, and ${req.min_test_samples??30} later test observations. These are sample requirements, not evidence of profit.`));
  root.append(make('p',`Modeled costs: ${settings.fee_pct??'Unavailable'}% fee per side; ${settings.slippage_bps??'Unavailable'} basis points adverse slippage per side; recorded bid/ask spread. Each run starts with ${money(settings.initial_cash)} virtual cash per strategy and symbol.`,'market-note'));
  const data=report.data;if(data)root.append(make('p',`${data.valid??0} valid observations from ${data.received??0} received · ${data.symbols_evaluated??0} symbols evaluated${data.symbols_omitted?' · '+data.symbols_omitted+' symbols omitted by the run limit':''}.`));
  for(const result of report.symbols||[]){const card=make('article','','insight-validation-symbol');card.append(make('h3',`${result.symbol} · ${String(result.status).replaceAll('_',' ')}`));
   if(result.reason)card.append(make('p',result.reason));
   card.append(make('small',`${result.samples_used??result.samples_available??0} observations used · ${result.samples_available??0} available${result.dropped_for_limit?' · '+result.dropped_for_limit+' earlier observations outside the run limit':''}`));
   if(!result.test||!result.baseline){root.append(card);continue;}
   const split=result.split;
   if(split)card.append(make('p',`Training: ${split.train.samples} observations · ${when(split.train.start_at)} to ${when(split.train.end_at)}. Later test: ${split.test.samples} observations · ${when(split.test.start_at)} to ${when(split.test.end_at)}.`));
   if(result.selected)card.append(make('p',`Settings chosen on training data and held fixed for the test: ${result.selected.lookback_samples}-observation lookback, ${result.selected.threshold_pct}% signal threshold. ${result.candidate_count??req.candidate_count??0} candidates compared on training data.`));
   card.append(make('p','Later test minus baseline net P&L: '+money(result.delta?.net_pnl),'validation-net-delta'));
   const table=make('table','','performance-table insight-validation-table'),thead=make('thead'),header=make('tr');for(const value of ['Metric','Training strategy','Later test strategy','Later test baseline'])header.append(make('th',value));thead.append(header);table.append(thead);const body=make('tbody');
   const metrics=[['Net P&L after modeled costs','net_pnl',money],['Return','return_pct',x=>Number.isFinite(x)?x.toFixed(2)+'%':'Unavailable'],['Closed trades','closed_trades',x=>Number.isFinite(x)?String(x):'Unavailable'],['Win rate','win_rate',x=>Number.isFinite(x)?x.toFixed(1)+'%':'No closed trades'],['Maximum drawdown','max_drawdown_pct',x=>Number.isFinite(x)?x.toFixed(2)+'%':'Unavailable'],['Fees','fees',money],['Slippage cost','slippage_cost',money],['Spread cost','spread_cost',money]];
   for(const [label,key,format]of metrics){const row=make('tr');row.append(make('th',label),make('td',format(result.training?.[key])),make('td',format(result.test[key])),make('td',format(result.baseline[key])));body.append(row);}table.append(body);card.append(tableWrap(table,result.symbol+' chronological validation results'),make('p','Training and later test cover different periods. Few closed trades or a positive result in one period do not establish dependable profitability.','market-note'));root.append(card);
  }
  if(report.method)root.append(make('p',report.method,'market-note'));
  if(data?.excluded){const details=make('details');details.append(make('summary','Excluded history and evaluation limits'),make('pre',JSON.stringify({excluded_observations:data.excluded,max_symbols:req.max_symbols,max_points_per_symbol:req.max_points_per_symbol},null,2)));root.append(details);}
  if(report.limitations?.length){const details=make('details');details.append(make('summary','Method limits and missing evidence'));const list=make('ul');for(const limit of report.limitations)list.append(make('li',limit));details.append(list);root.append(details);}
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
  for(const [id]of tabs){panel.querySelector('#insight-'+id).hidden=tab!==id;const button=panel.querySelector('#insight-tab-'+id);button.setAttribute('aria-selected',String(tab===id));button.tabIndex=tab===id?0:-1;}
  renderAgents();renderReadiness();renderPerformance();renderValidation();
 }
 window.addEventListener('desk-data',e=>{if(!e.detail.insights)return;latest=e.detail.insights;render();});
 window.addEventListener('desk-navigate',e=>{if(!latest||!tabs.some(([id])=>id===e.detail?.tab))return;tab=e.detail.tab;render();if(tab==='memory'&&!memoryLoaded)search();});
 if(window.dotsDeskData?.insights){latest=window.dotsDeskData.insights;render();}
})();
