(()=> {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const nativeTargets={
    downtime:'launchDowntimeBtn',
    floor:'floor',
    'check-sheets':'check-sheets',
    'repairs-maintenance':'launchRepairMaintenanceBtn',
    'hub-settings':'yardHubSettingsBtn',
    'staff-management':'launchStaffManagementBtn',
    gatelog:'launchGatelogBtn'
  };
  let menu=null,loading=null,workspace=null,workspaceHome=null;

  function session(){return window.DowntimeCentral?.session||null}
  function endpoint(){return window.CENTRAL_CONFIG_ADMIN_API||''}
  function key(){return String(window.DOWNTIME_CENTRAL_API_KEY||'').trim()}
  function initials(title){return String(title||'').trim().split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase()||'+'}
  function nativeButton(kind){
    if(kind==='downtime')return document.getElementById(nativeTargets.downtime);
    if(kind==='repairs-maintenance')return document.getElementById(nativeTargets['repairs-maintenance']);
    if(kind==='hub-settings')return document.getElementById(nativeTargets['hub-settings']);
    if(kind==='gatelog')return document.getElementById(nativeTargets.gatelog);
    return document.querySelector('.yard-grid [data-app="'+kind+'"]');
  }
  async function loadPublishedMenu(){
    if(loading)return loading;
    const active=session();
    if(!active?.token||!endpoint())return null;
    loading=(async()=>{
      const response=await fetch(endpoint(),{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':key(),'x-downtime-session':active.token},
        body:JSON.stringify({action:'yard-hub-menu'})
      });
      let result={};try{result=await response.json()}catch{}
      if(!response.ok)throw new Error(result.error||'YARD HUB menu configuration is unavailable.');
      const departments=result.yardHubMenu?.departments;
      if(!Array.isArray(departments)||!departments.length)throw new Error('Published YARD HUB menu is empty or invalid.');
      menu={departments:departments.slice().sort((a,b)=>Number(a.order)-Number(b.order)),version:Number(result.publishedVersion)||0};
      renderMenu();
      return menu;
    })().catch(error=>{
      console.warn('YARD HUB menu configuration could not be loaded; using the built-in launcher.',error);
      return null;
    }).finally(()=>{loading=null});
    return loading;
  }
  function tileCopy(button,title,description,status){
    const copy=button.querySelector('.yard-tile-copy');
    if(!copy)return;
    const titleNode=copy.querySelector('strong'),descriptionNode=copy.querySelector('small'),statusNode=copy.querySelector('.yard-tile-status');
    if(titleNode)titleNode.textContent=title;
    if(descriptionNode)descriptionNode.textContent=description||'';
    if(statusNode&&status)statusNode.textContent=status;
  }
  function makeCustomTile(entry){
    const button=document.createElement('button');
    button.type='button';button.className='yard-tile yard-tile-active yard-tile-custom';
    button.dataset.app='custom';button.dataset.structureId=entry.id;
    const icon=document.createElement('span');icon.className='yard-tile-icon yard-tile-custom-icon';icon.setAttribute('aria-hidden','true');icon.textContent=initials(entry.title);
    const divider=document.createElement('span');divider.className='yard-tile-divider';divider.setAttribute('aria-hidden','true');
    const copy=document.createElement('span');copy.className='yard-tile-copy';
    const title=document.createElement('strong');title.textContent=entry.title;
    const description=document.createElement('small');description.textContent=entry.description||'APPLICATION WORKSPACE';
    const status=document.createElement('span');status.className='yard-tile-status';status.textContent=(entry.submenus||[]).some(item=>item.enabled!==false)?'OPEN SUB-MENUS':'CONFIGURED WORKSPACE';
    copy.append(title,description,status);button.append(icon,divider,copy);return button;
  }
  function renderMenu(){
    const grid=$('.yard-grid');if(!grid||!menu)return;
    grid.querySelectorAll('.yard-tile-custom').forEach(button=>button.remove());
    const current=new Map();
    grid.querySelectorAll('.yard-tile[data-app]').forEach(button=>current.set(button.dataset.app,button));
    const ordered=[];
    menu.departments.forEach(entry=>{
      const kind=entry.kind||'custom';
      const button=kind==='custom'?makeCustomTile(entry):nativeButton(kind);
      if(!button)return;
      button.dataset.structureId=entry.id;
      button.dataset.structureKind=kind;
      if(entry.enabled===false&&kind!=='staff-management')button.hidden=true;
      else if(kind!=='hub-settings')button.hidden=false;
      button.setAttribute('aria-label','Open '+entry.title+' department');
      const hasSubmenus=(entry.submenus||[]).some(item=>item.enabled!==false);
      const status=hasSubmenus?'OPEN SUB-MENUS':undefined;
      tileCopy(button,entry.title,entry.description,status);
      if(kind==='custom')button.disabled=false;
      if(kind==='floor'||kind==='check-sheets'){
        button.disabled=!hasSubmenus;
        button.classList.toggle('yard-tile-active',hasSubmenus);
        button.classList.toggle('yard-tile-locked',!hasSubmenus);
      }
      ordered.push(button);
    });
    // Retain built-in buttons for application modules not present in an older config,
    // but keep them out of the visible launcher when not registered in the published menu.
    current.forEach((button,app)=>{
      if(ordered.includes(button))return;
      if(app==='staff-management'){button.hidden=false;return;}
      button.hidden=true;
    });
    ordered.forEach(button=>grid.append(button));
    window.syncStaffModuleAccess?.();
    window.syncDowntimeModuleAccess?.();
  }
  function ensureWorkspace(){
    if(workspace)return workspace;
    const host=$('.yard-hub-inner');if(!host)return null;
    workspace=document.createElement('section');workspace.className='yard-structure-screen';workspace.hidden=true;
    workspace.setAttribute('aria-label','Department workspace');workspace.setAttribute('role','main');workspace.tabIndex=-1;
    const header=document.createElement('header');header.className='yard-structure-header';
    const back=document.createElement('button');back.type='button';back.className='yard-hub-back yard-structure-back';back.textContent='‹ BACK TO YARD HUB';
    back.addEventListener('click',returnHome);
    const eyebrow=document.createElement('div');eyebrow.className='yard-hub-settings-eyebrow';eyebrow.textContent='YARD OPERATIONS CORE · DEPARTMENT WORKSPACE';
    const title=document.createElement('h1');title.className='yard-structure-title';
    const description=document.createElement('p');description.className='yard-structure-description';
    header.append(back,eyebrow,title,description);
    const status=document.createElement('div');status.className='yard-structure-status';
    const list=document.createElement('div');list.className='yard-structure-links';
    const note=document.createElement('div');note.className='yard-structure-note';
    note.textContent='This workspace was generated from the published application structure. Operational functionality can be assigned to it separately.';
    workspace.append(header,status,list,note);host.append(workspace);
    workspaceHome={title,description,status,list,note};
    return workspace;
  }
  function setHomeVisible(visible){
    const hub=$('#yardHub');if(!hub)return;
    ['.yard-hero','.yard-grid','.yard-modules-heading','.yard-hub-footer'].forEach(selector=>{const node=hub.querySelector(selector);if(node)node.hidden=!visible});
    const settings=$('#yardHubSettingsScreen');if(settings&&visible===false)settings.hidden=true;
  }
  function openWorkspace(title,description,items=[],parentTitle=''){
    const screen=ensureWorkspace();if(!screen)return;
    setHomeVisible(false);screen.hidden=false;
    workspaceHome.title.textContent=title;
    workspaceHome.description.textContent=description||parentTitle||'Department workspace';
    workspaceHome.status.textContent=parentTitle?parentTitle.toUpperCase()+' · MENU':'CONFIGURATION-DRIVEN WORKSPACE';
    workspaceHome.list.replaceChildren();
    const enabled=(items||[]).filter(item=>item.enabled!==false).sort((a,b)=>Number(a.order)-Number(b.order));
    enabled.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='yard-structure-link';
      const label=document.createElement('strong');label.textContent=item.label||item.title||'Untitled';
      const sub=document.createElement('small');sub.textContent='OPEN WORKSPACE';
      button.append(label,sub);
      button.addEventListener('click',()=>openWorkspace(item.label||item.title,'This sub-menu has been created in the application structure. Its dedicated functionality can be configured separately.',[],title));
      workspaceHome.list.append(button);
    });
    workspaceHome.note.hidden=enabled.length>0;
    window.scrollTo({top:0,behavior:'instant'});
    requestAnimationFrame(()=>screen.focus({preventScroll:true}));
  }
  function returnHome(){
    if(workspace)workspace.hidden=true;
    setHomeVisible(true);
    window.scrollTo({top:0,behavior:'instant'});
    window.dispatchEvent(new Event('yard-hub:shown'));
  }
  function onGridClick(event){
    const button=event.target.closest('.yard-grid .yard-tile[data-structure-id]');
    if(!button||!menu)return;
    const entry=menu.departments.find(item=>item.id===button.dataset.structureId);
    if(!entry)return;
    const submenus=(entry.submenus||[]).filter(item=>item.enabled!==false);
    if((entry.kind||'custom')==='gatelog'){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      window.GATELOG?.open();return;
    }
    if((entry.kind||'custom')==='custom'||submenus.length){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      openWorkspace(entry.title,entry.description,submenus,entry.title);
    }
  }
  function bind(){
    const grid=$('.yard-grid');if(grid)grid.addEventListener('click',onGridClick,true);
    window.addEventListener('yard-hub:shown',()=>{loadPublishedMenu()});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#yardHub')&&!$('#yardHub').hidden)loadPublishedMenu()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
