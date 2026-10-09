(() => {
 const groups=[
  ['Workspace',[
   ['overview','Overview','.desk-controls','grid'],['testing-setup','Testing setup','#testing-readiness','check'],['balance','Balance history','.balance','chart'],['events','Live events','.feed','activity'],['markets','Markets','.markets-panel','chart'],['agents','Agent desk','.chamber','users'],['activity','Agent activity','#insight-agents','activity','agents']]],
  ['Research',[
   ['research','Research room','#research-room','search'],['wallets','Wallet research','#wallet-research','wallet'],['agent-lab','Agent lab','#agent-lab','users'],['shadow','Shadow analysis','#shadow-review','eye'],['learning','Adaptive learning','#learning-lab','chart'],['memory','Memory','#insight-memory','archive','memory'],['readiness','System checks','#insight-readiness','check','readiness'],['validation','Strategy validation','#insight-validation','check','validation']]],
  ['Trading',[
   ['simulation','Simulation','#simulation-panel','chart'],['broker','Paper broker','#broker-panel','wallet'],['positions','Paper positions','#positions-list','layers'],['ledger','Trade ledger','#ledger-list','archive'],['performance','Simulation performance','#insight-performance','chart','performance'],['results','Account results','#performance-quality','chart'],['replay','Strategy replay','.replay-panel','history']]],
  ['Safety',[
   ['risk','Risk controls','#risk-headroom','shield'],['guards','Portfolio guards','#smart-safety','shield'],['regimes','Market regimes','#market-regimes','chart'],['quality','Quote quality','#decision-quality','check'],['sources','Source health','#source-health-grid','activity'],['alerts','Alerts','#alerts-list','bell']]],
  ['Settings',[
   ['risk-settings','Risk settings','#risk-settings','settings',null,'action'],['ai-setup','AI connection','.api-setup-access button','settings',null,'action'],['gmgn-setup','GMGN connection','.gmgn-setup-access','settings',null,'action']]]
 ];
 const icons={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',chart:'M3 3v18h18 M6 15l4-5 4 3 6-8',users:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a6 6 0 0 1 3 5',activity:'M2 12h4l3-8 5 16 3-8h5',search:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',archive:'M3 3h18v5H3z M5 8v13h14V8 M9 12h6',check:'M20 11v9H4V4h11 M8 11l4 4 10-12',wallet:'M3 5h16v15H3z M15 10h6v6h-6z',layers:'M2 7l10-5 10 5-10 5z M2 12l10 5 10-5 M2 17l10 5 10-5',history:'M3 8a9 9 0 1 1 0 8 M3 2v6h6 M12 7v6l4 2',shield:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2'};
 const node=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]||icons.grid);svg.append(path);return svg;};
 const sidebar=node('aside','','desk-sidebar');sidebar.id='desk-navigation';sidebar.setAttribute('aria-label','Desk navigation');
 const head=node('div','','sidebar-head'),brand=node('a','','sidebar-brand');brand.href='#desk-top';brand.append(node('strong','DotsTrading'),node('small','LEDGER DESK'));head.append(brand);
 const collapse=node('button','‹','sidebar-collapse');collapse.type='button';collapse.setAttribute('aria-label','Collapse navigation');head.append(collapse);sidebar.append(head);
 const mode=node('div','','sidebar-mode');mode.append(node('span','','sidebar-status-dot'),node('span','Paper desk · connecting'));sidebar.append(mode);
 const nav=node('nav');nav.setAttribute('aria-label','Dashboard sections');const items=[];
 for(const [label,entries]of groups){const section=node('div','','sidebar-group');section.append(node('h2',label));
  for(const [id,title,selector,glyph,tab,action]of entries){const a=node('a','','sidebar-link');a.href='#section-'+id;a.title=title;a.dataset.nav=id;a.append(icon(glyph),node('span',title));section.append(a);items.push({id,title,selector,tab,action,link:a});a.onclick=e=>{e.preventDefault();navigate(id,true);};}nav.append(section);
 }sidebar.append(nav);
 const foot=node('div','','sidebar-foot'),exportLink=node('a','','sidebar-link');exportLink.href='/api/export';exportLink.download='dots-paper-ledger.json';exportLink.title='Export ledger';exportLink.append(icon('archive'),node('span','Export ledger'));foot.append(exportLink);
 const status=node('p','Sections become available when the desk loads.','sidebar-note');status.setAttribute('role','status');foot.append(status);sidebar.append(foot);
 const topbar=node('div','','desk-mobile-bar'),toggle=node('button','','sidebar-toggle');toggle.type='button';toggle.append(icon('layers'),node('span','Menu'));toggle.setAttribute('aria-controls',sidebar.id);toggle.setAttribute('aria-expanded','false');topbar.append(toggle,node('strong','DotsTrading'),node('small','PAPER'));
 const backdrop=node('button','','sidebar-backdrop');backdrop.type='button';backdrop.setAttribute('aria-label','Close navigation');backdrop.tabIndex=-1;
 const skip=node('a','Skip to dashboard','desk-skip-link');skip.href='#desk-top';
 document.body.prepend(skip,topbar,backdrop,sidebar);const main=document.querySelector('.terminal');main.id='desk-top';main.tabIndex=-1;document.body.classList.add('has-desk-navigation');
 const mobile=window.matchMedia('(max-width:1100px)');let active='overview',pending=null,pinnedUntil=0,frame=0;
 let compact=false;try{compact=localStorage.getItem('dots-navigation-compact')==='true';}catch{}
 function layout(){document.body.classList.toggle('desk-nav-compact',compact&&!mobile.matches);collapse.textContent=compact&&!mobile.matches?'›':'‹';collapse.setAttribute('aria-label',mobile.matches?'Close navigation':compact?'Expand navigation':'Collapse navigation');collapse.setAttribute('aria-expanded',String(!compact));}
 function drawer(open){document.body.classList.toggle('desk-nav-open',open);toggle.setAttribute('aria-expanded',String(open));if(open)sidebar.querySelector('.sidebar-link').focus();else if(mobile.matches)toggle.focus();}
 collapse.onclick=()=>{if(mobile.matches){drawer(false);return;}compact=!compact;try{localStorage.setItem('dots-navigation-compact',String(compact));}catch{}layout();};toggle.onclick=()=>drawer(!document.body.classList.contains('desk-nav-open'));backdrop.onclick=()=>drawer(false);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('desk-nav-open')){drawer(false);return;}if(e.key==='Tab'&&mobile.matches&&document.body.classList.contains('desk-nav-open')){const focusable=[...sidebar.querySelectorAll('a,button')],first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 mobile.addEventListener('change',()=>{drawer(false);layout();});layout();
 function target(item){const element=document.querySelector(item.selector);if(!element)return null;if(item.action)return element;if(['positions','ledger','alerts','risk','sources','results','guards','regimes','quality'].includes(item.id))return element.closest('article')||element;return element;}
 function bindTargets(){for(const item of items){const element=target(item);item.link.setAttribute('aria-disabled',String(!element));item.link.classList.toggle('nav-pending',!element);if(element&&!element.id&&!item.action&&!item.tab)element.id='section-'+item.id;}if(pending){const id=pending;pending=null;navigate(id,false);}}
 function mark(id){active=id;for(const item of items){if(item.id===id)item.link.setAttribute('aria-current','location');else item.link.removeAttribute('aria-current');}}
 function navigate(id,updateHash){const item=items.find(i=>i.id===id);if(!item)return;let element=target(item);
  if(!element){pending=id;status.textContent=item.title+' will open when the desk finishes loading.';return;}
  if(item.action){if(mobile.matches)drawer(false);element.click();status.textContent=item.title+' opened.';return;}
  if(item.tab)window.dispatchEvent(new CustomEvent('desk-navigate',{detail:{tab:item.tab}}));
  element=target(item);if(element.hidden){status.textContent='Waiting for '+item.title+' to load.';pending=id;return;}
  if(updateHash)history.pushState(null,'','#section-'+id);mark(id);pinnedUntil=Date.now()+900;if(mobile.matches)drawer(false);
  element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  element.tabIndex=-1;element.focus({preventScroll:true});status.textContent=item.title+' selected.';
 }
 function track(){frame=0;if(Date.now()<pinnedUntil)return;let candidate=null;for(const item of items){if(item.action)continue;const element=target(item);if(!element||element.hidden)continue;const top=element.getBoundingClientRect().top;if(top<=140&&(!candidate||top>candidate.top))candidate={id:item.id,top};}if(candidate)mark(candidate.id);}
 window.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(track);},{passive:true});window.addEventListener('wheel',()=>{pinnedUntil=0;},{passive:true});
 function hashRoute(){const id=location.hash.replace('#section-','');if(items.some(i=>i.id===id))navigate(id,false);}
 window.addEventListener('popstate',hashRoute);window.addEventListener('hashchange',hashRoute);
 window.addEventListener('desk-tab-selected',e=>{const item=items.find(i=>i.tab===e.detail?.tab);if(item){mark(item.id);history.replaceState(null,'','#section-'+item.id);}});
 window.addEventListener('desk-data',e=>{bindTargets();const s=e.detail.engine;mode.querySelector('span:last-child').textContent=s?.halted?'Paper desk · halted':s?.last_tick?'Paper desk · monitoring':'Paper desk · awaiting data';mode.classList.toggle('sidebar-halted',Boolean(s?.halted));if(e.detail.paper?.alerts){const unread=e.detail.paper.alerts.filter(a=>!a.read).length;const link=items.find(i=>i.id==='alerts').link;link.querySelector('.nav-count')?.remove();if(unread){const badge=node('b',unread>99?'99+':String(unread),'nav-count');badge.setAttribute('aria-label',unread+' unread alerts');link.append(badge);}}});
 bindTargets();mark(active);hashRoute();if(window.dotsDeskData)window.dispatchEvent(new CustomEvent('desk-data',{detail:window.dotsDeskData}));
 function signOut(){const form=document.querySelector('form[action="/logout"]');if(!form)return;form.className='sidebar-signout';form.removeAttribute('style');const button=form.querySelector('button');button.className='sidebar-signout-button';button.title='Sign out';button.replaceChildren(icon('history'),node('span','Sign out'));foot.append(form);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',signOut,{once:true});else signOut();
})();
