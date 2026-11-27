import {createId} from "./config-core.js";
import {calculateDayMetrics,calculateWeekMetrics,getEntryDurationMinutes,rankDowntimeCauses,validateDowntimeEntry} from "./domain/downtime.js";
import {saveAndLockDailyTasks,setTaskCompletion,visibleDailyTasks,completedTaskCount,createDailyTaskState} from "./domain/daily-tasks.js";
import {calculateScheduleForDate,formatMinutes,parseClock} from "./domain/schedule.js";
import {buildWeeklyReport} from "./domain/reports.js";
import {assignStationOperator,createPlantState,normalizePlantState,setPlantStatus,setStationStatus} from "./domain/plant.js";
import {createWorkspaceBackup,restoreWorkspaceBackup,validateWorkspaceBackup} from "./domain/backup.js";
import {factoryResetStorage} from "./domain/factory-reset.js";
import {createConnectedGitHubStore,createPrivateGitHubDataRepository,loadGitHubConnection,saveGitHubConnection,clearGitHubConnection} from "./infrastructure/github-connection.js";

const STORE_PREFIX="downtimeui:operations:v1:";
const WORKSPACE_BINDINGS=new WeakMap();
const DAY_NAMES=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_CODES=["mon","tue","wed","thu","fri","sat"];
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const localIso=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
const fromIso=value=>new Date(value+"T12:00:00");
const weekStartFor=value=>{const date=typeof value==="string"?fromIso(value):new Date(value);date.setHours(12,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return date;};
const addDays=(date,count)=>{const value=new Date(date);value.setDate(value.getDate()+count);return value;};
const dayName=value=>DAY_NAMES[(fromIso(value).getDay()+6)%7];
const keyFor=installationId=>STORE_PREFIX+installationId;
function makeEmptyOperations(installationId){return {schemaVersion:1,installationId,weeks:{},reports:[],plant:createPlantState(),updatedAt:null};}
function makeDay(date,config){
  return {date,start:"",stop:"",operatorId:"",entries:[],dailyTasks:createDailyTaskState(),createdAt:new Date().toISOString()};
}
function safeGet(storage,key){try{return {ok:true,value:storage?.getItem(key)||null};}catch(error){return {ok:false,error:error?.message||"Local storage unavailable."};}}
function readOperations(storage,installationId){
  const empty=makeEmptyOperations(installationId),read=safeGet(storage,keyFor(installationId));
  if(!read.ok)return {state:empty,error:read.error};
  if(!read.value)return {state:empty,error:null};
  try{
    const parsed=JSON.parse(read.value);
    if(parsed?.installationId!==installationId||parsed?.schemaVersion!==1)return {state:empty,error:"Saved operations data did not match this workspace. A fresh local workspace was started."};
    return {state:{...empty,...parsed,weeks:parsed.weeks||{},reports:Array.isArray(parsed.reports)?parsed.reports:[],plant:normalizePlantState(parsed.plant)},error:null};
  }catch{return {state:empty,error:"Saved local operations data could not be read. A fresh local workspace was started."};}
}
function saveOperations(storage,state){
  try{
    state.updatedAt=new Date().toISOString();
    storage.setItem(keyFor(state.installationId),JSON.stringify(state));
    return {ok:true};
  }catch(error){return {ok:false,error:error?.message||"Local storage quota or access error."};}
}
function fileDownload(name,mime,body){
  const blob=new Blob([body],{type:mime}),url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
  globalThis.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function labelForDay(date){
  const dateObject=fromIso(date);
  return {name:DAY_NAMES[(dateObject.getDay()+6)%7],short:DAY_NAMES[(dateObject.getDay()+6)%7].slice(0,3).toUpperCase(),date:dateObject.toLocaleDateString("en-GB",{day:"2-digit",month:"short"})};
}
function scheduleLabel(date,schedule){
  const result=calculateScheduleForDate(date,schedule);
  return result.shifts.map(item=>Math.floor(item.startMinute/60).toString().padStart(2,"0")+":"+String(item.startMinute%60).padStart(2,"0")+"–"+Math.floor(item.endMinute%1440/60).toString().padStart(2,"0")+":"+String(item.endMinute%60).padStart(2,"0"));
}
export function mountWorkspace(root,config,{onEditConfiguration=()=>{},onExportConfiguration=()=>{},onRestoreConfiguration=()=>({ok:true}) }={},options={}){
  if(!root)throw new Error("Workspace mount point is required.");
  WORKSPACE_BINDINGS.get(root)?.();
  if(!config?.installed||!config.installationId)throw new Error("A validated installed workspace is required.");
  config={
    ...config,
    identity:{companyName:"",locale:"en-GB",timezone:"UTC",...(config.identity||{})},
    site:{siteName:"",hierarchy:["Area","Station"],...(config.site||{}),areas:Array.isArray(config.site?.areas)?config.site.areas:[],stations:Array.isArray(config.site?.stations)?config.site.stations:[]},
    downtime:{...(config.downtime||{}),reasons:Array.isArray(config.downtime?.reasons)?config.downtime.reasons:[]},
    schedule:{...(config.schedule||{}),workDays:Array.isArray(config.schedule?.workDays)?config.schedule.workDays:[],shifts:Array.isArray(config.schedule?.shifts)?config.schedule.shifts:[],breaks:Array.isArray(config.schedule?.breaks)?config.schedule.breaks:[]},
    staff:Array.isArray(config.staff)?config.staff:[],
    roles:Array.isArray(config.roles)?config.roles:[],
    dailyTasks:Array.isArray(config.dailyTasks)?config.dailyTasks:[]
  };
  const storage=options.storage||globalThis.localStorage;
  const githubSettingsStorage=options.settingsStorage||globalThis.localStorage;
  const githubSessionStorage=options.sessionStorage||globalThis.sessionStorage;
  const bindingController=new AbortController();
  let refreshInterval=null,githubSyncTimer=null,githubSyncInFlight=false,githubSyncQueued=false;
  let githubStore=null,githubAuthority=null,githubSnapshotVersion=null,lastGitHubSyncAt=null,githubSyncBlocked=false;
  const disposeBinding=()=>{
    bindingController.abort();
    if(refreshInterval!==null){globalThis.clearInterval?.(refreshInterval);refreshInterval=null;}
    if(githubSyncTimer!==null){
      globalThis.clearTimeout?.(githubSyncTimer);githubSyncTimer=null;
      if(githubSyncQueued&&githubStore)void flushGitHubSnapshot();
    }
  };
  WORKSPACE_BINDINGS.set(root,disposeBinding);
  const loaded=readOperations(storage,config.installationId);
  const getNow=()=>options.now?new Date(options.now()):new Date();
  const getLocalClock=()=>{
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:config.identity.timezone||"UTC",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(getNow());
    return parts.find(x=>x.type==="hour").value+":"+parts.find(x=>x.type==="minute").value;
  };
  const getLocalDate=()=>{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:config.identity.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(getNow());
    return parts.find(x=>x.type==="year").value+"-"+parts.find(x=>x.type==="month").value+"-"+parts.find(x=>x.type==="day").value;
  };
  let state=loaded.state,view="daily",selectedWeek=weekStartFor(getLocalDate()),selectedDate=getLocalDate(),status=loaded.error||"Local workspace ready.",editingEntryId=null;
  let lastPersistedState=JSON.parse(JSON.stringify(state));
  function getWeekKey(){return localIso(selectedWeek);}
  function ensurePlantState(){
    state.plant=normalizePlantState(state.plant);
    return state.plant;
  }
  function ensureWeek(){
    const key=getWeekKey();
    if(!state.weeks[key])state.weeks[key]={days:Array.from({length:7},(_,i)=>makeDay(localIso(addDays(selectedWeek,i)),config))};
    const week=state.weeks[key];
    if(!Array.isArray(week.days))week.days=[];
    for(let i=0;i<7;i++){
      const date=localIso(addDays(selectedWeek,i));
      if(!week.days[i]||week.days[i].date!==date)week.days[i]=makeDay(date,config);
      week.days[i].entries=Array.isArray(week.days[i].entries)?week.days[i].entries:[];
      week.days[i].dailyTasks=week.days[i].dailyTasks||createDailyTaskState();
    }
    return week;
  }
  function currentDay(){return ensureWeek().days.find(x=>x.date===selectedDate)||ensureWeek().days[0];}
  function metricsForDay(day){
    if(day.start&&!day.stop&&day.date===getLocalDate()){
      const liveEnd=getLocalClock();
      return calculateDayMetrics({...day,stop:liveEnd,breakMinutes:undefined},config.schedule);
    }
    return calculateDayMetrics(day,config.schedule);
  }
  function currentMetrics(){return metricsForDay(currentDay());}
  function weekMetrics(key=getWeekKey()){
    const monday=fromIso(key),week=state.weeks[key]||{days:Array.from({length:7},(_,i)=>makeDay(localIso(addDays(monday,i)),config))};
    return calculateWeekMetrics(week.days.map(day=>day.start&&!day.stop&&day.date===getLocalDate()?{...day,stop:getLocalClock(),breakMinutes:undefined}:day),config.schedule);
  }
  function persist(message="Saved on this device."){
    const candidate=JSON.parse(JSON.stringify(state));
    const result=saveOperations(storage,candidate);
    if(result.ok){
      lastPersistedState=JSON.parse(JSON.stringify(candidate));
      status=message;
      queueGitHubSnapshot();
      return true;
    }
    state=JSON.parse(JSON.stringify(lastPersistedState));
    status="Save failed; unsaved changes were rolled back: "+result.error;
    render();
    return false;
  }
  function updateWorkspaceStatus(message){
    status=message;
    root.querySelectorAll(".workspace-message,.workspace-footer span:first-child").forEach(node=>{node.textContent=message;});
  }
  function queueGitHubSnapshot(){
    if(!githubStore)return;
    if(githubSyncBlocked){
      githubSyncQueued=false;
      updateWorkspaceStatus("Local save retained. GitHub has a different snapshot; choose Restore latest snapshot or explicitly replace it using Sync workspace now.");
      return;
    }
    githubSyncQueued=true;
    if(githubSyncTimer!==null)globalThis.clearTimeout?.(githubSyncTimer);
    updateWorkspaceStatus("Saved locally. GitHub backup queued.");
    githubSyncTimer=globalThis.setTimeout?.(()=>{
      githubSyncTimer=null;
      void flushGitHubSnapshot();
    },Number.isFinite(options.githubSyncDebounceMs)?Math.max(250,options.githubSyncDebounceMs):900)??null;
  }
  async function flushGitHubSnapshot(){
    if(!githubStore||githubSyncInFlight||githubSyncBlocked)return;
    githubSyncInFlight=true;
    try{
      while(githubSyncQueued&&githubStore){
        githubSyncQueued=false;
        const backup=createWorkspaceBackup(config,JSON.parse(JSON.stringify(state)),{exportedAt:getNow()});
        const result=await githubStore.writeSnapshot({
          module:"YARDHUB_WORKSPACE",
          snapshotId:config.installationId,
          actorId:options.actorId||"LOCAL-OPERATOR",
          payload:{backup},
          expectedVersion:githubSnapshotVersion
        });
        githubSnapshotVersion=result.snapshot.version;
        lastGitHubSyncAt=result.snapshot.updatedAt;
        updateWorkspaceStatus("GitHub backup saved · version "+githubSnapshotVersion+" · "+lastGitHubSyncAt);
      }
    }catch(error){
      githubSyncQueued=false;
      updateWorkspaceStatus("Local data is retained. GitHub backup failed: "+(error?.message||"Unknown error"));
    }finally{
      githubSyncInFlight=false;
    }
  }
  async function connectGitHubStore(){
    try{
      const saved=saveGitHubConnection({
        owner:root.querySelector("[data-github-owner]")?.value||"",
        repo:root.querySelector("[data-github-repo]")?.value||"",
        branch:root.querySelector("[data-github-branch]")?.value||"",
        token:root.querySelector("[data-github-token]")?.value||""
      },{storage:githubSettingsStorage,sessionStorage:githubSessionStorage});
      githubStore=await createConnectedGitHubStore({storage:githubSettingsStorage,fetchImpl:options.fetchImpl||globalThis.fetch});
      await githubStore.ensureAuthority();
      githubAuthority=await githubStore.readAuthority();
      const snapshot=await githubStore.readSnapshot({module:"YARDHUB_WORKSPACE",snapshotId:config.installationId});
      githubSnapshotVersion=snapshot?.version??null;
      lastGitHubSyncAt=snapshot?.updatedAt||null;
      const local= createWorkspaceBackup(config,JSON.parse(JSON.stringify(state)),{exportedAt:getNow()});
      const remote=snapshot?.payload?.backup;
      const equalState=Boolean(remote&&JSON.stringify(remote.configuration)===JSON.stringify(local.configuration)&&JSON.stringify(remote.operations)===JSON.stringify(local.operations));
      githubSyncBlocked=Boolean(snapshot&&!equalState);
      status="GitHub connected · "+saved.owner+"/"+saved.repo+" · primary: "+githubAuthority.primarySystemId+(snapshot?(githubSyncBlocked?" · snapshot v"+snapshot.version+" differs from this device":" · snapshot v"+snapshot.version+" matches this device"):" · no remote snapshot yet");
      render();
      if(!snapshot){githubSyncQueued=true;void flushGitHubSnapshot();}
    }catch(error){
      githubStore=null;githubAuthority=null;githubSnapshotVersion=null;githubSyncBlocked=false;
      clearGitHubConnection({storage:githubSettingsStorage});
      status="GitHub connection failed: "+(error?.message||"Check the private repository and token.");
      render();
    }
  }
  async function createGitHubPrivateRepository(){
    try{
      const created=await createPrivateGitHubDataRepository({
        owner:root.querySelector("[data-github-owner]")?.value||"",
        repo:root.querySelector("[data-github-repo]")?.value||"",
        token:root.querySelector("[data-github-token]")?.value||"",
        storage:githubSettingsStorage,
        fetchImpl:options.fetchImpl||globalThis.fetch
      });
      const branchInput=root.querySelector("[data-github-branch]");
      if(branchInput)branchInput.value=created.defaultBranch;
      await connectGitHubStore();
    }catch(error){
      status="Private data repository creation failed: "+(error?.message||"Check repository name and token permissions.");
      render();
    }
  }
  function disconnectGitHubStore(){
    clearGitHubConnection({storage:githubSettingsStorage,sessionStorage:githubSessionStorage});
    githubStore=null;githubAuthority=null;githubSnapshotVersion=null;githubSyncQueued=false;githubSyncBlocked=false;
    updateWorkspaceStatus("GitHub disconnected. Local browser storage remains available.");
    render();
  }
  async function syncGitHubNow(){
    if(!githubStore){updateWorkspaceStatus("Connect the GitHub data store first.");return;}
    if(githubSyncTimer!==null){globalThis.clearTimeout?.(githubSyncTimer);githubSyncTimer=null;}
    if(githubSyncBlocked){
      if(typeof globalThis.confirm!=="function"||!globalThis.confirm("The GitHub snapshot differs from this browser. Replace the remote snapshot with this browser's current workspace? The remote version will remain in Git history."))return;
      githubSyncBlocked=false;
    }
    githubSyncQueued=true;
    await flushGitHubSnapshot();
  }
  async function restoreGitHubSnapshot(){
    if(!githubStore){updateWorkspaceStatus("Connect the GitHub data store first.");return;}
    try{
      const snapshot=await githubStore.readSnapshot({module:"YARDHUB_WORKSPACE",snapshotId:config.installationId});
      if(!snapshot?.payload?.backup){updateWorkspaceStatus("No GitHub workspace snapshot exists for this installation.");return;}
      const backup=snapshot.payload.backup;
      const validation=validateWorkspaceBackup(backup,config.installationId);
      if(!validation.ok){updateWorkspaceStatus("GitHub snapshot rejected: "+validation.errors.join(" "));return;}
      if(typeof globalThis.confirm==="function"&&!globalThis.confirm("Replace this browser's local workspace with GitHub snapshot version "+snapshot.version+"?"))return;
      const restored=restoreWorkspaceBackup(backup,config.installationId,{storage});
      if(!restored.ok){updateWorkspaceStatus("GitHub restore failed: "+restored.errors.join(" "));return;}
      const parentSync=onRestoreConfiguration(restored.configuration);
      if(parentSync?.ok===false){updateWorkspaceStatus("GitHub records restored, but the installer handoff failed: "+(parentSync.error||"Unknown error"));return;}
      for(const key of Object.keys(config))delete config[key];
      Object.assign(config,restored.configuration);
      state=restored.operations;
      state.plant=normalizePlantState(state.plant);
      lastPersistedState=JSON.parse(JSON.stringify(state));
      githubSnapshotVersion=snapshot.version;
      githubSyncBlocked=false;
      lastGitHubSyncAt=snapshot.updatedAt||null;
      selectedDate=getLocalDate();selectedWeek=weekStartFor(selectedDate);editingEntryId=null;
      status="GitHub workspace snapshot v"+snapshot.version+" restored.";
      ensureWeek();render();
    }catch(error){
      updateWorkspaceStatus("GitHub restore failed: "+(error?.message||"Unknown error"));
    }
  }
  function renderGitHubConnectionPanel(){
    const connection=loadGitHubConnection({storage:githubSettingsStorage,sessionStorage:githubSessionStorage});
    const connected=Boolean(githubStore);
    const authorityLabel=githubAuthority?("Primary: "+githubAuthority.primarySystemId+" · epoch "+githubAuthority.epoch):"Not connected";
    const syncLabel=lastGitHubSyncAt?("Last snapshot: "+lastGitHubSyncAt):"No snapshot written in this session";
    return '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Private GitHub data connection</h2><p>Connect only a dedicated private repository reserved for this installation. Public code repositories and the protected DOWNTIME repository are blocked.</p></div><span class="workspace-count">'+(connected?"CONNECTED":"NOT CONNECTED")+'</span></div>'+
      '<div class="workspace-form-grid">'+
      '<label><span>GitHub owner</span><input data-github-owner value="'+esc(connection.owner)+'" autocomplete="off"></label>'+
      '<label><span>Repository</span><input data-github-repo value="'+esc(connection.repo)+'" autocomplete="off"></label>'+
      '<label class="workspace-full"><span>Data branch</span><input data-github-branch value="'+esc(connection.branch)+'" autocomplete="off"></label>'+
      '<label class="workspace-full"><span>Fine-grained GitHub token · memory only</span><input data-github-token type="password" autocomplete="off" placeholder="Re-enter after reload"></label></div>'+
      '<div class="workspace-button-row"><button type="button" data-action="github-create">Create private data repository</button><button type="button" data-action="github-connect">Connect and verify</button><button type="button" data-action="github-disconnect">Disconnect</button><button type="button" data-action="github-sync" '+(!connected?"disabled":"") +'>Sync workspace now</button><button type="button" data-action="github-restore" '+(!connected?"disabled":"") +'>Restore latest snapshot</button></div>'+
      '<p class="workspace-muted">'+esc(authorityLabel)+' · '+esc(syncLabel)+'</p>'+
      '<p class="workspace-muted">Security gate: the configured repository must be private and separate from application source. Tokens are memory-only and cleared on disconnect or page reload. Direct browser access still exposes the connected repository’s records to that trusted operator; this is not yet a multi-user server-side broker. Do not connect staff accounts or production records until the server-side authorization gateway and private repository are configured.</p></div>';
  }
  function nav(){
    return [["daily","Daily sheet"],["plant","Plant overview"],["tasks","Daily tasks"],["weekly","Weekly summary"],["reports","Reports"],["people","People & settings"]].map(([id,name])=>'<button type="button" class="workspace-nav '+(view===id?"active":"")+'" data-view="'+id+'">'+name+'</button>').join("");
  }
  function metricCard(label,value,sub=""){
    return '<article class="workspace-metric"><span>'+label+'</span><strong>'+value+'</strong>'+(sub?'<small>'+sub+'</small>':'')+'</article>';
  }
  function renderDaily(){
    const week=ensureWeek(),metrics=currentMetrics(),day=currentDay(),selectedSchedule=scheduleLabel(selectedDate,config.schedule),isLiveShift=Boolean(day.start&&!day.stop&&selectedDate===getLocalDate()),displayedSchedule=day.start&&day.stop?[day.start+"–"+day.stop+" (actual)"]:isLiveShift?[day.start+"–"+getLocalClock()+" (LIVE)"]:selectedSchedule;
    const kpis=[["NET AVAILABLE",formatMinutes(metrics.netMinutes)],["DOWNTIME",formatMinutes(metrics.downtimeMinutes)],["RUNNING",formatMinutes(metrics.runningMinutes)],["DOWNTIME RATE",metrics.downtimeRate.toFixed(1)+"%"]];
    const days=week.days.map(item=>{
      const m=metricsForDay(item),d=labelForDay(item.date);
      return '<button type="button" data-day="'+item.date+'" class="workspace-day '+(item.date===selectedDate?"selected":"")+'"><b>'+d.short+'</b><span>'+d.date+'</span><small>'+formatMinutes(m.downtimeMinutes)+'</small>'+(item.dailyTasks?.lockedAt?'<i>LOCKED</i>':'')+'</button>';
    }).join("");
    const people=Array.isArray(config.staff)?config.staff:[];
    const editingEntry=day.entries.find(entry=>entry.id===editingEntryId)||null;
    const entries=day.entries.length?day.entries.map((entry,index)=>'<div class="workspace-entry"><div class="workspace-entry-copy"><b>'+esc(entry.area)+'</b><span>'+esc(entry.reason)+(entry.stationId?" · "+esc(config.site.stations.find(x=>x.id===entry.stationId)?.name||"Station"):"")+'</span></div><strong>'+formatMinutes(getEntryDurationMinutes(entry))+'</strong><button type="button" data-action="edit-entry" data-entry-id="'+esc(entry.id)+'" aria-label="Edit downtime entry '+(index+1)+'">Edit</button><button type="button" data-action="delete-entry" data-entry-id="'+esc(entry.id)+'" aria-label="Delete downtime entry '+(index+1)+'">×</button></div>').join(""):'<div class="workspace-empty">No downtime has been recorded for this day.</div>';
    const areaOptions=(config.site.areas||[]).map(x=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join("");
    const stationOptions=(config.site.stations||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
    const reasonOptions=(config.downtime.reasons||[]).map(x=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join("");
    const presetOptions=(config.downtime.presets||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
    const operatorOptions=people.map(x=>'<option value="'+esc(x.id)+'" '+(day.operatorId===x.id?"selected":"")+'>'+esc(x.name)+'</option>').join("");
    return '<section class="workspace-section">'+
      '<div class="workspace-section-head"><div><div class="workspace-eyebrow">DAILY OPERATIONS</div><h1>'+esc(dayName(selectedDate))+'</h1><p>'+fromIso(selectedDate).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})+'</p></div><div class="workspace-day-lock">'+(day.dailyTasks?.lockedAt?'<span>DAILY TASKS LOCKED</span>':'<span>DAILY TASKS OPEN</span>')+'</div></div>'+
      '<div class="workspace-daystrip">'+days+'</div>'+
      '<div class="workspace-metrics">'+kpis.map(x=>metricCard(x[0],x[1])).join("")+'</div>'+
      '<div class="workspace-two-col"><div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Downtime entries</h2><p>Record time lost against an area and reason.</p></div><span class="workspace-count">'+day.entries.length+' ENTRIES</span></div>'+
      '<div class="workspace-entry-list">'+entries+'</div>'+
      ((config.downtime.presets||[]).length?'<div class="workspace-preset-apply"><label><span>Quick-entry preset</span><select data-entry-preset><option value="">Choose a saved preset</option>'+presetOptions+'</select></label><button type="button" data-action="apply-entry-preset">Apply preset</button><small>Check the populated fields before saving.</small></div>':'')+
      '<div class="workspace-add-form"><h3>'+(editingEntry?"Edit downtime entry":"Add downtime entry")+'</h3><div class="workspace-form-grid">'+
      '<label><span>Area / location *</span><input name="entry-area" list="workspace-areas" placeholder="Enter or select an area" value="'+esc(editingEntry?.area||"")+'"></label><datalist id="workspace-areas">'+areaOptions+'</datalist>'+
      '<label><span>Station (optional)</span><select name="entry-station"><option value="">No station selected</option>'+stationOptions.replace('value="'+esc(editingEntry?.stationId||"")+'"','value="'+esc(editingEntry?.stationId||"")+'" selected')+'</select></label>'+
      '<label class="workspace-full"><span>Reason *</span><input name="entry-reason" list="workspace-reasons" placeholder="Enter or select a reason" value="'+esc(editingEntry?.reason||"")+'"></label><datalist id="workspace-reasons">'+reasonOptions+'</datalist>'+
      '<label><span>Hours</span><input name="entry-hours" type="number" min="0" max="999" step="1" value="'+esc(editingEntry?.hours??0)+'"></label>'+
      '<label><span>Minutes</span><input name="entry-minutes" type="number" min="0" max="59" step="1" value="'+esc(editingEntry?.minutes??0)+'"></label></div>'+
      '<div class="workspace-form-actions"><span>Entry is saved to this browser only.</span><div class="workspace-form-button-row">'+(editingEntry?'<button type="button" data-action="cancel-edit">Cancel</button>':'')+'<button type="button" class="workspace-primary" data-action="save-entry">'+(editingEntry?"Save changes":"Save downtime")+'</button></div></div><div class="workspace-message" role="status">'+esc(status)+'</div></div></div>'+
      '<aside class="workspace-panel"><div class="workspace-panel-head"><div><h2>Shift summary</h2><p>Configured schedule or actual override for this date.</p></div></div>'+
      '<div class="workspace-actual-shift"><div><h3>Actual shift times</h3><p>Record this day’s actual start and finish. Leave the values unset to use the configured schedule.</p></div>'+
      '<div class="workspace-shift-inputs"><label><span>Start</span><input type="time" data-shift-start value="'+esc(day.start||"")+'"></label><label><span>Finish</span><input type="time" data-shift-stop value="'+esc(day.stop||"")+'"></label></div>'+
      '<div class="workspace-shift-actions">'+
      (isLiveShift?'<button type="button" class="workspace-primary" data-action="stop-shift-now">Stop shift now</button>':(!day.start&&selectedDate===getLocalDate()?'<button type="button" class="workspace-primary" data-action="start-shift-now">Start shift now</button>':''))+
      '<button type="button" data-action="save-shift-times">Save actual times</button>'+
      (day.start&&day.stop?'<button type="button" data-action="clear-shift-times">Use configured schedule</button>':'')+
      '</div></div>'+
      '<div class="workspace-schedule-line"><span>Shift window</span><strong>'+(displayedSchedule.length?displayedSchedule.map(esc).join("<br>"):"Not configured")+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Break deduction</span><strong>'+formatMinutes(metrics.breakMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Scheduled time</span><strong>'+formatMinutes(metrics.scheduledMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Net available</span><strong>'+formatMinutes(metrics.netMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Operator on duty</span><strong>'+(people.length?esc(people.find(x=>x.id===day.operatorId)?.name||"Not assigned"):"Not configured")+'</strong></div>'+
      '<label class="workspace-operator"><span>Assign operator</span><select data-operator><option value="">Not assigned</option>'+operatorOptions+'</select></label>'+
      (metrics.exceedsNetTime?'<div class="workspace-alert">Recorded downtime exceeds net available time. Check the entry durations.</div>':'')+
      '<div class="workspace-inline-actions"><button type="button" data-view="tasks">Open daily tasks</button><button type="button" data-view="weekly">View weekly summary</button></div></aside></div></section>';
  }
  function renderPlantOverview(){
    const plant=ensurePlantState(),stations=Array.isArray(config.site.stations)?config.site.stations:[],areas=Array.isArray(config.site.areas)?config.site.areas:[],staff=Array.isArray(config.staff)?config.staff:[];
    const statusNames={running:"Running",down:"Down",maintenance:"Maintenance",idle:"Idle"};
    const assignedStationFor=person=>stations.find(station=>plant.assignments[station.id]===person.id)||null;
    const operatorCards=staff.map(person=>{
      const station=assignedStationFor(person);
      const picture=person.photoDataUrl
        ?'<img src="'+esc(person.photoDataUrl)+'" alt="'+esc(person.name)+'">'
        :'<span>'+esc((person.name||"").trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join("")||"—")+'</span>';
      return '<article class="workspace-operator-card"><div class="workspace-operator-photo">'+picture+'</div><b>'+esc(person.name)+'</b><span>'+esc(station?.name||"Unassigned")+'</span></article>';
    }).join("");
    const stationCards=new Map();
    stations.forEach(station=>{
      const status=plant.stationStates[station.id]||"running",assigned=plant.assignments[station.id]||"";
      const area=areas.find(item=>item.id===station.areaId);
      const card='<article class="workspace-station-card status-'+status+'"><div class="workspace-station-heading"><div><span class="workspace-station-indicator"></span><b>'+esc(station.name)+'</b></div><span class="workspace-status-label">'+statusNames[status]+'</span></div>'+
        '<small>'+esc(area?.name||"Unassigned area")+'</small>'+
        '<label><span>Station status</span><select data-station-status="'+esc(station.id)+'">'+Object.entries(statusNames).map(([key,label])=>'<option value="'+key+'" '+(status===key?"selected":"")+'>'+label+'</option>').join("")+'</select></label>'+
        '<label><span>Assigned operator</span><select data-station-operator="'+esc(station.id)+'"><option value="">Not assigned</option>'+staff.map(person=>'<option value="'+esc(person.id)+'" '+(assigned===person.id?"selected":"")+'>'+esc(person.name)+'</option>').join("")+'</select></label></article>';
      stationCards.set(station.id,card);
    });
    const down=stations.filter(x=>(plant.stationStates[x.id]||"running")==="down");
    const maintenance=stations.filter(x=>(plant.stationStates[x.id]||"running")==="maintenance");
    const unassigned=stations.filter(x=>!plant.assignments[x.id]);
    const alerts=[];
    if(plant.status==="stopped")alerts.push('<div class="workspace-plant-alert critical"><b>Site stopped</b><span>The overall site status is set to stopped.</span></div>');
    if(down.length)alerts.push('<div class="workspace-plant-alert critical"><b>'+down.length+' station'+(down.length===1?"":"s")+' down</b><span>'+down.map(x=>esc(x.name)).join(", ")+'</span></div>');
    if(maintenance.length)alerts.push('<div class="workspace-plant-alert warning"><b>Maintenance status</b><span>'+maintenance.map(x=>esc(x.name)).join(", ")+'</span></div>');
    if(unassigned.length)alerts.push('<div class="workspace-plant-alert neutral"><b>Unassigned stations</b><span>'+unassigned.map(x=>esc(x.name)).join(", ")+'</span></div>');
    const history=plant.history.slice(-8).reverse().map(item=>'<div class="workspace-history-row"><span>'+esc(item.label)+'</span><small>'+new Date(item.at).toLocaleString("en-GB")+'</small></div>').join("");
    const areaGroups=areas.map(area=>{
      const group=stations.filter(station=>station.areaId===area.id);
      if(!group.length)return "";
      return '<section class="workspace-area-group"><div class="workspace-area-head"><h2>'+esc(area.name)+'</h2><span>'+group.length+' STATION'+(group.length===1?"":"S")+'</span></div><div class="workspace-station-grid">'+group.map(station=>stationCards.get(station.id)).join("")+'</div></section>';
    }).filter(Boolean);
    const ungrouped=stations.filter(station=>!areas.some(area=>area.id===station.areaId));
    if(ungrouped.length)areaGroups.push('<section class="workspace-area-group"><div class="workspace-area-head"><h2>Other stations</h2><span>'+ungrouped.length+' STATION'+(ungrouped.length===1?"":"S")+'</span></div><div class="workspace-station-grid">'+ungrouped.map(station=>stationCards.get(station.id)).join("")+'</div></section>');
    return '<section class="workspace-section"><div class="workspace-section-head"><div><div class="workspace-eyebrow">SITE STATUS</div><h1>Plant overview</h1><p>'+esc(config.site.siteName)+' · '+stations.length+' configured station'+(stations.length===1?"":"s")+'</p></div><button type="button" class="workspace-plant-toggle '+(plant.status==="running"?"on":"off")+'" data-action="toggle-plant">'+(plant.status==="running"?"PLANT RUNNING · SET STOPPED":"PLANT STOPPED · SET RUNNING")+'</button></div>'+
      (alerts.length?'<div class="workspace-plant-alerts">'+alerts.join("")+'</div>':'<div class="workspace-plant-alert neutral"><b>All clear</b><span>No active station issues are recorded.</span></div>')+
      (staff.length?'<section class="workspace-operator-allocation"><div class="workspace-area-head"><h2>Operator allocation</h2><span>'+staff.length+' STAFF</span></div><div class="workspace-operator-grid">'+operatorCards+'</div></section>':'')+
      (stations.length?areaGroups.join(""):'<div class="workspace-panel"><div class="workspace-empty">No stations have been configured. Add stations in workspace setup to populate Plant Overview.</div></div>')+

      '<div class="workspace-panel workspace-history"><div class="workspace-panel-head"><div><h2>Recent status changes</h2><p>Local audit trail for plant and station changes.</p></div></div>'+(history||'<div class="workspace-empty">No status changes recorded yet.</div>')+'</div>'+
      '<div class="workspace-message" role="status">'+esc(status)+'</div></section>';
  }
  function renderTasks(){
    const day=currentDay(),week=ensureWeek(),templates=Array.isArray(config.dailyTasks)?config.dailyTasks:[],locked=Boolean(day.dailyTasks?.lockedAt);
    const tasks=visibleDailyTasks(day.dailyTasks,templates),done=new Set(day.dailyTasks?.completedTaskIds||[]);
    const count=completedTaskCount({...day.dailyTasks,snapshot:locked?day.dailyTasks.snapshot:templates});
    const rows=tasks.map(task=>'<label class="workspace-task '+(done.has(task.id)?"done":"")+'"><input type="checkbox" data-task="'+esc(task.id)+'" '+(done.has(task.id)?"checked":"")+(locked?" disabled":"")+'><span>'+esc(task.name)+'</span></label>').join("");
    const days=week.days.map(item=>{
      const metrics=calculateDayMetrics(item,config.schedule),label=labelForDay(item.date);
      return '<button type="button" data-day="'+item.date+'" class="workspace-day '+(item.date===selectedDate?"selected":"")+'"><b>'+label.short+'</b><span>'+label.date+'</span><small>'+formatMinutes(metrics.downtimeMinutes)+'</small>'+(item.dailyTasks?.lockedAt?'<i>LOCKED</i>':'')+'</button>';
    }).join("");
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">DAILY CONTROL</div><h1>Daily tasks</h1><p class="workspace-lead">Checklist for '+esc(dayName(selectedDate))+' · '+esc(selectedDate)+'. Select a date to review its checklist. Save and lock to freeze that date’s snapshot.</p>'+
      '<div class="workspace-week-nav"><button type="button" data-action="previous-week">← Previous week</button><button type="button" data-action="current-week">Current week</button><button type="button" data-action="next-week">Next week →</button></div>'+
      '<div class="workspace-daystrip">'+days+'</div>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Task checklist</h2><p>'+(locked?"This day's task snapshot is immutable.":"Mark completed tasks, then save and lock for the day.")+'</p></div><span class="workspace-count">'+count+' / '+tasks.length+' COMPLETE</span></div>'+
      '<div class="workspace-progress"><span style="width:'+(tasks.length?count/tasks.length*100:0)+'%"></span></div>'+
      (tasks.length?'<div class="workspace-task-list">'+rows+'</div>':'<div class="workspace-empty">No daily task templates are configured. Add tasks in workspace setup.</div>')+
      (locked?'<div class="workspace-lock-banner"><b>Saved and locked</b><span>Locked '+esc(new Date(day.dailyTasks.lockedAt).toLocaleString("en-GB"))+'. This checklist cannot be edited.</span></div>':'<div class="workspace-task-actions"><span>Changes are stored locally before the lock is applied.</span><button type="button" class="workspace-primary" data-action="lock-tasks" '+(!tasks.length?"disabled":"")+' >SAVE &amp; LOCK FOR TODAY</button></div>')+
      '<div class="workspace-message" role="status">'+esc(status)+'</div></div></section>';
  }
  function renderWeekly(){
    const week=ensureWeek(),metrics=weekMetrics(),days=week.days.map(day=>({day,metrics:calculateDayMetrics(day,config.schedule)}));
    const previousKey=localIso(addDays(selectedWeek,-7)),previousDays=state.weeks[previousKey]?.days||[];
    const report=buildWeeklyReport({weekStart:getWeekKey(),days:week.days,previousDays,schedule:config.schedule,companyName:config.identity.companyName,siteName:config.site.siteName});
    const causes=rankDowntimeCauses(week.days),top=causes[0],best=days.filter(x=>x.metrics.netMinutes>0).sort((a,b)=>b.metrics.runningRate-a.metrics.runningRate)[0],worst=days.slice().sort((a,b)=>b.metrics.downtimeMinutes-a.metrics.downtimeMinutes)[0];
    const delta=report.comparison?.downtimeDeltaMinutes;
    const comparison=report.comparison?(delta>0?"+"+formatMinutes(delta)+" vs previous week":delta<0?"−"+formatMinutes(Math.abs(delta))+" vs previous week":"No change vs previous week"):"No previous-week data";
    const body=days.map(({day,metrics:m})=>'<tr><td>'+esc(dayName(day.date))+'</td><td>'+esc(day.operatorId?config.staff.find(x=>x.id===day.operatorId)?.name||"—":"—")+'</td><td>'+day.date+'</td><td>'+formatMinutes(m.netMinutes)+'</td><td>'+formatMinutes(m.downtimeMinutes)+'</td><td>'+formatMinutes(m.runningMinutes)+'</td><td>'+m.downtimeRate.toFixed(1)+'%</td><td>'+m.runningRate.toFixed(1)+'%</td></tr>').join("");
    const causesBody=causes.length?causes.slice(0,5).map(item=>'<div class="workspace-cause-row"><span>'+esc(item.reason)+'</span><b>'+formatMinutes(item.minutes)+'</b><small>'+(metrics.downtimeMinutes?(item.minutes/metrics.downtimeMinutes*100).toFixed(1):"0.0")+'%</small></div>').join(""):'<div class="workspace-empty">No downtime causes recorded this week.</div>';
    return '<section class="workspace-section"><div class="workspace-eyebrow">PERFORMANCE</div><h1>Weekly summary</h1><p class="workspace-lead">'+selectedWeek.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+' — '+addDays(selectedWeek,6).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+'</p>'+
      '<div class="workspace-week-nav"><button type="button" data-action="previous-week">← Previous week</button><button type="button" data-action="current-week">Current week</button><button type="button" data-action="next-week">Next week →</button></div>'+
      '<div class="workspace-metrics">'+metricCard("NET AVAILABLE",formatMinutes(metrics.netMinutes))+metricCard("WEEKLY DOWNTIME",formatMinutes(metrics.downtimeMinutes))+metricCard("RUNNING",formatMinutes(metrics.runningMinutes))+metricCard("DOWNTIME RATE",metrics.downtimeRate.toFixed(1)+"%")+'</div>'+
      '<div class="workspace-insights">'+
      '<article><span>TOP DOWNTIME CAUSE</span><b>'+(top?esc(top.reason):"—")+'</b><small>'+(top&&metrics.downtimeMinutes?(top.minutes/metrics.downtimeMinutes*100).toFixed(1)+"% of weekly downtime":"No recorded causes")+'</small></article>'+
      '<article><span>WEEK-ON-WEEK</span><b>'+esc(comparison)+'</b><small>'+(report.comparison?"Compared with the previous recorded week":"Comparison becomes available when the previous week has data")+'</small></article>'+
      '<article><span>BEST RUNNING DAY</span><b>'+(best?esc(dayName(best.day.date)):"—")+'</b><small>'+(best?best.metrics.runningRate.toFixed(1)+"% running":"No scheduled time")+'</small></article>'+
      '<article><span>HIGHEST DOWNTIME</span><b>'+(worst&&worst.metrics.downtimeMinutes?esc(dayName(worst.day.date)):"—")+'</b><small>'+(worst?formatMinutes(worst.metrics.downtimeMinutes):"No downtime recorded")+'</small></article></div>'+
      '<div class="workspace-two-col"><div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Day-by-day performance</h2><p>Weekly rates use aggregate minutes, not an average of daily percentages.</p></div></div><div class="workspace-table-wrap"><table><thead><tr><th>Day</th><th>Operator</th><th>Date</th><th>Net</th><th>Downtime</th><th>Running</th><th>Downtime %</th><th>Running %</th></tr></thead><tbody>'+body+'</tbody></table></div></div>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Downtime causes</h2><p>Share of total recorded downtime.</p></div></div>'+causesBody+'</div></div></section>';
  }
  function renderReports(){
    const reports=state.reports.slice().sort((a,b)=>String(b.generatedAt).localeCompare(String(a.generatedAt)));
    const rows=reports.map(report=>'<article class="workspace-report-row"><div><b>Week starting '+esc(report.weekStart||"—")+'</b><small>'+esc(report.siteName||config.site.siteName)+' · '+formatMinutes(report.totals?.downtimeMinutes||0)+' downtime · '+Number(report.totals?.downtimeRate||0).toFixed(1)+'%</small></div><div><button type="button" data-action="print-report" data-report-id="'+esc(report.id)+'">Print / PDF</button><button type="button" data-action="export-report" data-report-id="'+esc(report.id)+'">Export JSON</button></div></article>').join("");
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">ARCHIVE</div><h1>Weekly reports</h1><p class="workspace-lead">Generate a dated report snapshot from the selected week. Browser print supports saving a PDF.</p>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Report archive</h2><p>Stored locally with this workspace.</p></div><button type="button" class="workspace-primary" data-action="generate-report">Generate report</button></div>'+
      (rows||'<div class="workspace-empty">No reports generated yet.</div>')+'</div></section>';
  }
  function renderPeople(){
    const areasList=Array.isArray(config.site.areas)?config.site.areas:[];
    const stationsList=Array.isArray(config.site.stations)?config.site.stations:[];
    const reasonsList=Array.isArray(config.downtime?.reasons)?config.downtime.reasons:[];
    const presetsList=Array.isArray(config.downtime?.presets)?config.downtime.presets:[];
    const workDays=Array.isArray(config.schedule?.workDays)?config.schedule.workDays:[];
    const shiftsList=Array.isArray(config.schedule?.shifts)?config.schedule.shifts:[];
    const breaksList=Array.isArray(config.schedule?.breaks)?config.schedule.breaks:[];
    const staffList=Array.isArray(config.staff)?config.staff:[];
    const rolesList=Array.isArray(config.roles)?config.roles:[];
    const tasksList=Array.isArray(config.dailyTasks)?config.dailyTasks:[];
    const section=(title,description,step,details,actionLabel="Edit section")=>
      '<article class="workspace-setting-card"><div class="workspace-setting-copy"><span>'+esc(title)+'</span><p>'+esc(description)+'</p><small>'+details+'</small></div><button type="button" data-action="edit-section" data-step="'+step+'">'+actionLabel+' →</button></article>';
    const counts=[
      ["Areas",areasList.length],["Stations",stationsList.length],
      ["Downtime reasons",reasonsList.length],["Quick-entry presets",presetsList.length],["Operating days",workDays.length],
      ["Shifts",shiftsList.length],["Breaks",breaksList.length],
      ["Staff",staffList.length],["Access roles",rolesList.length],["Daily task templates",tasksList.length]
    ];
    const staff=staffList.map(person=>{const role=rolesList.find(item=>item.id===person.roleId);return '<span class="workspace-chip">'+esc(person.name)+(role?' · '+esc(role.name):"")+'</span>';}).join("")||'<span class="workspace-muted">No staff configured</span>';
    const roles=rolesList.map(role=>'<span class="workspace-chip">'+esc(role.name)+'</span>').join("")||'<span class="workspace-muted">No roles configured</span>';
    const stat=counts.map(([label,count])=>'<div class="workspace-setting-stat"><b>'+count+'</b><span>'+label+'</span></div>').join("");
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">WORKSPACE ADMINISTRATION</div><h1>Settings</h1><p class="workspace-lead">All company, site and operational configuration is maintained here after installation. Changes are saved to this browser workspace.</p>'+
      '<div class="workspace-settings-stats">'+stat+'</div>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Company and site identity</h2><p>Organisation name, branding, regional format and site hierarchy.</p></div></div>'+
      '<div class="workspace-config-pair"><span>Company</span><b>'+esc(config.identity.companyName)+'</b></div><div class="workspace-config-pair"><span>Site</span><b>'+esc(config.site.siteName)+'</b></div><div class="workspace-config-pair"><span>Time zone</span><b>'+esc(config.identity.timezone)+'</b></div>'+
      '<div class="workspace-settings-edit"><button type="button" data-action="edit-section" data-step="1">Edit company identity →</button><button type="button" data-action="edit-section" data-step="2">Edit site structure →</button></div></div>'+
      '<div class="workspace-settings-grid">'+
      section("Downtime reasons and presets","Manage reason names and reusable area, station, reason and duration combinations for quick entry.",3,reasonsList.length+" reasons · "+presetsList.length+" quick-entry presets"+(presetsList.length?": "+presetsList.map(x=>esc(x.name)).join(" · "):""))+
      section("Schedule and breaks","Set work days, shift windows, break periods and local time settings.",4,workDays.length+" work days · "+shiftsList.length+" shifts · "+breaksList.length+" breaks")+
      section("Staff and operators","Maintain the roster used for assignments and operational reporting.",5,staff)+
      section("Access and rights","Configure permission groups. Account authentication and server-side enforcement are separate.",6,roles)+
      section("Daily task presets","Maintain reusable task templates for the daily checklist.",7,tasksList.map(x=>esc(x.name)).join(" · ")||"No task templates defined")+
      '</div>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Data and recovery</h2><p>Export a copy of this installation’s configuration and local records.</p></div></div><p class="workspace-muted">Operational records, checklist locks and report snapshots are stored in browser storage, namespaced by this installation ID. This is not a central backup or a multi-user sync service.</p><div class="workspace-button-row"><button type="button" data-action="export-backup">Export full workspace backup</button><button type="button" data-action="import-backup">Import workspace backup</button><button type="button" data-action="export-config">Export configuration JSON</button></div><input type="file" accept=".json,application/json" data-backup-file hidden></div>'+
      renderGitHubConnectionPanel()+
      '<div class="workspace-panel workspace-danger-zone"><div class="workspace-panel-head"><div><h2>WIPE OUT</h2><p>Factory reset this browser workspace.</p></div></div><p class="workspace-muted">This removes this installation’s configuration, operational records, task locks, reports, and saved setup draft from this browser. You can optionally restore a JSON backup instead.</p><button type="button" class="workspace-danger-button" data-action="factory-reset">WIPE OUT — Factory reset</button></div><div class="workspace-message" role="status">'+esc(status)+'</div></section>';
  }
  function render(){
    const week=ensureWeek();
    const content=view==="daily"?renderDaily():view==="plant"?renderPlantOverview():view==="tasks"?renderTasks():view==="weekly"?renderWeekly():view==="reports"?renderReports():renderPeople();
    root.innerHTML='<div class="workspace-app"><header class="workspace-header"><div class="workspace-brand"><span class="workspace-brand-mark">D</span><div><b>'+esc(config.identity.companyName)+'</b><small>'+esc(config.site.siteName)+' · DOWNTIMEUI</small></div></div><div class="workspace-header-actions"><span class="workspace-local-tag">'+(githubStore?"LOCAL + GITHUB SNAPSHOT":"LOCAL MODE · SINGLE DEVICE")+'</span><button type="button" data-action="export-backup">Backup</button></div></header>'+
      '<nav class="workspace-navigation">'+nav()+'</nav><div class="workspace-content">'+content+'</div><footer class="workspace-footer"><span>'+esc(status)+'</span><span>'+(githubStore?"GitHub snapshot backup is connected; cross-device authority and full module parity are still in development.":"Data is stored in this browser. Shared access and server sync are not active.")+'</span></footer></div>';
  }
  function selectedWeekMove(offset){
    selectedWeek=addDays(selectedWeek,offset*7);
    selectedDate=localIso(selectedWeek);
    ensureWeek();render();
  }
  function findField(name){
    const el=root.querySelector('[name="'+name+'"]');
    return String(el?.value??"");
  }
  function saveEntry(){
    const previous=currentDay().entries.find(entry=>entry.id===editingEntryId)||null;
    const entry={id:previous?.id||createId("entry"),area:findField("entry-area").trim(),stationId:findField("entry-station")||null,reason:findField("entry-reason").trim(),
      hours:Number(findField("entry-hours"))||0,minutes:Number(findField("entry-minutes"))||0,createdAt:previous?.createdAt||getNow().toISOString(),updatedAt:previous?getNow().toISOString():null};
    const errors=validateDowntimeEntry(entry);
    if(errors.length){status=errors.join(" ");render();return;}
    const day=currentDay(),previousEntries=day.entries.slice(),previousEditingId=editingEntryId;
    if(previous){day.entries=day.entries.map(item=>item.id===previous.id?entry:item);editingEntryId=null;}
    else day.entries.push(entry);
    if(persist(previous?"Downtime entry updated locally.":"Downtime entry saved locally."))render();
    else{day.entries=previousEntries;editingEntryId=previousEditingId;render();}
  }
  function generateReport(){
    const week=ensureWeek(),previousKey=localIso(addDays(selectedWeek,-7)),previous=state.weeks[previousKey]?.days||[];
    const report=buildWeeklyReport({weekStart:getWeekKey(),days:week.days,previousDays:previous,schedule:config.schedule,companyName:config.identity.companyName,siteName:config.site.siteName,generatedAt:getNow()});
    report.id=createId("report");
    const previousReports=state.reports.slice();
    state.reports.push(report);
    if(persist("Weekly report snapshot created.")){view="reports";render();}
    else{state.reports=previousReports;render();}
  }
  function downloadReport(report){
    if(report)fileDownload("downtime-weekly-report-"+(report.weekStart||"week")+".json","application/json",JSON.stringify(report,null,2));
  }
  function printReport(report){
    if(!report)return;
    const printable='<div class="workspace-print-report"><h1>'+esc(report.companyName)+'</h1><h2>'+esc(report.siteName)+' · Weekly performance report</h2><p>Week starting '+esc(report.weekStart)+' · Generated '+esc(report.generatedAt)+'</p><div class="workspace-print-kpis"><b>Net available: '+formatMinutes(report.totals.netMinutes)+'</b><b>Downtime: '+formatMinutes(report.totals.downtimeMinutes)+'</b><b>Running: '+formatMinutes(report.totals.runningMinutes)+'</b><b>Downtime rate: '+report.totals.downtimeRate.toFixed(1)+'%</b></div><table><thead><tr><th>Day</th><th>Date</th><th>Net</th><th>Downtime</th><th>Running</th><th>Down %</th><th>Run %</th></tr></thead><tbody>'+report.days.map(d=>'<tr><td>'+esc(d.name)+'</td><td>'+esc(d.date)+'</td><td>'+formatMinutes(d.metrics.netMinutes)+'</td><td>'+formatMinutes(d.metrics.downtimeMinutes)+'</td><td>'+formatMinutes(d.metrics.runningMinutes)+'</td><td>'+d.metrics.downtimeRate.toFixed(1)+'%</td><td>'+d.metrics.runningRate.toFixed(1)+'%</td></tr>').join("")+'</tbody></table></div>';
    const old=root.querySelector(".workspace-print-stage");if(old)old.remove();
    root.insertAdjacentHTML("beforeend",'<div class="workspace-print-stage">'+printable+'</div>');
    globalThis.print?.();
  }
  function editConfig(){onEditConfiguration();}
  function exportBackup(){
    const backup=createWorkspaceBackup(config,state);
    fileDownload("downtimeui-workspace-backup.json","application/json",JSON.stringify(backup,null,2));
  }
  async function restoreBackup(file){
    if(!file)return;
    let backup;
    try{backup=JSON.parse(await file.text());}
    catch{status="Backup rejected: file is not valid JSON.";render();return;}
    const validation=validateWorkspaceBackup(backup,config.installationId);
    if(!validation.ok){status="Backup rejected: "+validation.errors.join(" ");render();return;}
    if(typeof globalThis.confirm!=="function"||!globalThis.confirm("Replace this local workspace configuration and all local records with the selected backup? This cannot be undone.")){
      status="Backup restore cancelled.";render();return;
    }
    const restored=restoreWorkspaceBackup(backup,config.installationId,{storage});
    if(!restored.ok){status="Backup restore failed: "+restored.errors.join(" ");render();return;}
    const parentSync=onRestoreConfiguration(restored.configuration);
    if(parentSync?.ok===false){status="Backup restored to browser storage, but the setup controller could not refresh: "+(parentSync.error||"Configuration handoff failed.");render();return;}
    for(const key of Object.keys(config))delete config[key];
    Object.assign(config,restored.configuration);
    state=restored.operations;
    state.plant=normalizePlantState(state.plant);
    lastPersistedState=JSON.parse(JSON.stringify(state));
    selectedDate=getLocalDate();
    selectedWeek=weekStartFor(selectedDate);
    editingEntryId=null;
    view="daily";
    status="Workspace backup restored successfully.";
    ensureWeek();
    render();
  }

  root.addEventListener("click",event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.view){view=button.dataset.view;render();return;}
    if(button.dataset.day){selectedDate=button.dataset.day;render();return;}
    const action=button.dataset.action;if(!action)return;
    if(action==="apply-entry-preset"){
      const presetId=root.querySelector("[data-entry-preset]")?.value||"";
      const preset=(config.downtime.presets||[]).find(item=>item.id===presetId);
      if(!preset){status="Select a quick-entry preset first.";const message=root.querySelector(".workspace-message");if(message)message.textContent=status;return;}
      const area=(config.site.areas||[]).find(item=>item.id===preset.areaId);
      const reason=(config.downtime.reasons||[]).find(item=>item.id===preset.reasonId);
      const setValue=(selector,value)=>{const input=root.querySelector(selector);if(input&&value!==undefined&&value!==null)input.value=String(value);};
      if(area)setValue('[name="entry-area"]',area.name);
      if(preset.stationId)setValue('[name="entry-station"]',preset.stationId);
      if(reason)setValue('[name="entry-reason"]',reason.name);
      if(Number.isInteger(preset.defaultDurationMinutes)){
        setValue('[name="entry-hours"]',Math.floor(preset.defaultDurationMinutes/60));
        setValue('[name="entry-minutes"]',preset.defaultDurationMinutes%60);
      }
      status="Preset applied. Review the values before saving.";
      const message=root.querySelector(".workspace-message");if(message)message.textContent=status;
    }
    else if(action==="save-entry")saveEntry();
    else if(action==="edit-entry"){
      const entry=currentDay().entries.find(item=>item.id===button.dataset.entryId);
      if(!entry)return;
      editingEntryId=entry.id;render();
      root.querySelector('[name="entry-area"]')?.focus?.();
    }
    else if(action==="cancel-edit"){editingEntryId=null;render();}
    else if(action==="delete-entry"){
      const day=currentDay(),previousEntries=day.entries.slice(),previousEditingId=editingEntryId;
      day.entries=day.entries.filter(x=>x.id!==button.dataset.entryId);
      if(editingEntryId===button.dataset.entryId)editingEntryId=null;
      if(persist("Downtime entry removed."))render();
      else{day.entries=previousEntries;editingEntryId=previousEditingId;render();}
    }
    else if(action==="toggle-plant"){
      const previous=ensurePlantState();
      const result=setPlantStatus(previous,previous.status==="running"?"stopped":"running");
      if(result.ok&&result.changed){state.plant=result.state;if(persist("Overall plant status updated locally."))render();else state.plant=previous;}
    }
    else if(action==="lock-tasks"){
      const day=currentDay(),before=day.dailyTasks;
      const result=saveAndLockDailyTasks(before,config.dailyTasks||[],{actorId:null,now:getNow()});
      if(!result.ok){status=result.errors.join(" ");render();return;}
      day.dailyTasks=result.state;
      if(persist("Daily tasks saved and locked for this day."))render();else day.dailyTasks=before;
    }
    else if(action==="start-shift-now"){
      const day=currentDay(),previousStart=day.start,previousStop=day.stop,previousBreak=day.breakMinutes;
      if(selectedDate!==getLocalDate()||day.start){status="A shift can only be started for today when no actual start is recorded.";render();return;}
      day.start=getLocalClock();delete day.stop;delete day.breakMinutes;
      if(persist("Shift started at "+day.start+" local time."))render();
      else{day.start=previousStart;day.stop=previousStop;if(previousBreak===undefined)delete day.breakMinutes;else day.breakMinutes=previousBreak;render();}
    }
    else if(action==="stop-shift-now"){
      const day=currentDay(),previousStop=day.stop,previousBreak=day.breakMinutes,nowTime=getLocalClock();
      if(selectedDate!==getLocalDate()||!day.start||day.stop||nowTime===day.start){status="A live shift cannot be stopped with an empty or zero-length time window.";render();return;}
      day.stop=nowTime;delete day.breakMinutes;
      if(persist("Shift stopped at "+day.stop+" local time."))render();
      else{day.stop=previousStop;if(previousBreak===undefined)delete day.breakMinutes;else day.breakMinutes=previousBreak;render();}
    }
    else if(action==="save-shift-times"){
      const start=root.querySelector("[data-shift-start]")?.value||"",stop=root.querySelector("[data-shift-stop]")?.value||"";
      if(!start||!stop||parseClock(start)===null||parseClock(stop)===null||start===stop){status="Enter a valid start and finish time. The times cannot be identical.";render();return;}
      const day=currentDay(),previousStart=day.start,previousStop=day.stop,previousBreak=day.breakMinutes;
      day.start=start;day.stop=stop;delete day.breakMinutes;
      if(persist("Actual shift times saved locally."))render();
      else{day.start=previousStart;day.stop=previousStop;if(previousBreak===undefined)delete day.breakMinutes;else day.breakMinutes=previousBreak;render();}
    }
    else if(action==="clear-shift-times"){
      const day=currentDay(),previousStart=day.start,previousStop=day.stop;
      delete day.start;delete day.stop;delete day.breakMinutes;
      if(persist("Configured schedule restored for this day."))render();
      else{day.start=previousStart;day.stop=previousStop;render();}
    }
    else if(action==="previous-week")selectedWeekMove(-1);
    else if(action==="next-week")selectedWeekMove(1);
    else if(action==="current-week"){selectedDate=getLocalDate();selectedWeek=weekStartFor(selectedDate);ensureWeek();render();}
    else if(action==="generate-report")generateReport();
    else if(action==="print-report"||action==="export-report"){
      const report=state.reports.find(x=>x.id===button.dataset.reportId);
      if(action==="print-report")printReport(report);else downloadReport(report);
    }
    else if(action==="factory-reset"){
      if(typeof globalThis.confirm!=="function"||!globalThis.confirm("WIPE OUT will permanently clear this DOWNTIMEUI workspace from this browser. Continue?")){status="Factory reset cancelled.";render();return;}
      const restoreFirst=typeof globalThis.confirm==="function"&&globalThis.confirm("DO YOU WANT TO RESTORE A BACKUP JSON FILE instead of starting empty?\n\nChoose OK to select and restore a backup. Choose Cancel to continue with an empty factory reset.");
      if(restoreFirst){status="Select a valid backup JSON file to restore. No data has been wiped.";render();root.querySelector("[data-backup-file]")?.click?.();return;}
      if(typeof globalThis.confirm!=="function"||!globalThis.confirm("Confirm final WIPE OUT? This will return to the empty installation screen.")){status="Factory reset cancelled.";render();return;}
      const wiped=factoryResetStorage(storage);
      if(!wiped.ok){status="Factory reset failed; local data was retained where rollback allowed: "+wiped.error;render();return;}
      globalThis.location?.reload?.();
    }
    else if(action==="github-create")void createGitHubPrivateRepository();
    else if(action==="github-connect")void connectGitHubStore();
    else if(action==="github-disconnect")disconnectGitHubStore();
    else if(action==="github-sync")void syncGitHubNow();
    else if(action==="github-restore")void restoreGitHubSnapshot();
    else if(action==="export-backup")exportBackup();
    else if(action==="import-backup")root.querySelector("[data-backup-file]")?.click?.();
    else if(action==="export-config")onExportConfiguration();
    else if(action==="edit-config"){disposeBinding();editConfig();}
    else if(action==="edit-section"){disposeBinding();onEditConfiguration(Number(button.dataset.step));}
  },{signal:bindingController.signal});
  root.addEventListener("change",async event=>{
    const control=event.target;
    if(control.matches("[data-backup-file]")){
      const file=control.files?.[0];
      if(file)await restoreBackup(file);
      control.value="";
      return;
    }
    if(control.matches("[data-task]")){
      const day=currentDay(),result=setTaskCompletion(day.dailyTasks,control.dataset.task,control.checked,config.dailyTasks||[]);
      if(!result.ok){status=result.message;render();return;}
      const previousTasks=day.dailyTasks;
      day.dailyTasks=result.state;
      if(!persist("Task completion saved locally.")){day.dailyTasks=previousTasks;render();return;}
      render();
    } else if(control.matches("[data-operator]")){
      const day=currentDay(),previousOperatorId=day.operatorId;
      day.operatorId=control.value||"";
      if(persist("Operator assignment saved locally."))render();
      else{day.operatorId=previousOperatorId||"";render();}
    } else if(control.matches("[data-station-status]")){
      const previous=ensurePlantState(),id=control.dataset.stationStatus,station=config.site.stations.find(item=>item.id===id);
      const result=setStationStatus(previous,{stationId:id,status:control.value,stationIds:(config.site.stations||[]).map(item=>item.id),stationName:station?.name||"Station"});
      if(!result.ok){status="Station status could not be updated.";render();return;}
      if(result.changed){state.plant=result.state;if(persist("Station status updated locally."))render();else state.plant=previous;}
    } else if(control.matches("[data-station-operator]")){
      const previous=ensurePlantState(),id=control.dataset.stationOperator,station=config.site.stations.find(item=>item.id===id),person=config.staff.find(item=>item.id===control.value);
      const result=assignStationOperator(previous,{stationId:id,staffId:control.value||null,
        stationIds:(config.site.stations||[]).map(item=>item.id),staffIds:(config.staff||[]).map(item=>item.id),
        stationName:station?.name||"Station",staffName:person?.name||"Operator"});
      if(!result.ok){status=result.message||"Station assignment could not be saved.";render();return;}
      if(result.changed){state.plant=result.state;if(persist("Station assignment saved locally."))render();else state.plant=previous;}
    }
  },{signal:bindingController.signal});
  selectedWeek=weekStartFor(selectedDate);
  ensureWeek();
  const savedGitHubConnection=loadGitHubConnection({storage:githubSettingsStorage});
  if(savedGitHubConnection.connected){
    status="Reconnecting to GitHub data store…";
    void (async()=>{
      try{
        githubStore=await createConnectedGitHubStore({storage:githubSettingsStorage,fetchImpl:options.fetchImpl||globalThis.fetch});
        await githubStore.ensureAuthority();
        githubAuthority=await githubStore.readAuthority();
        const snapshot=await githubStore.readSnapshot({module:"YARDHUB_WORKSPACE",snapshotId:config.installationId});
        githubSnapshotVersion=snapshot?.version??null;
        lastGitHubSyncAt=snapshot?.updatedAt||null;
        const local=createWorkspaceBackup(config,JSON.parse(JSON.stringify(state)),{exportedAt:getNow()});
        const remote=snapshot?.payload?.backup;
        const equalState=Boolean(remote&&JSON.stringify(remote.configuration)===JSON.stringify(local.configuration)&&JSON.stringify(remote.operations)===JSON.stringify(local.operations));
        githubSyncBlocked=Boolean(snapshot&&!equalState);
        status="GitHub connected · primary: "+githubAuthority.primarySystemId+(snapshot?(githubSyncBlocked?" · remote snapshot differs":" · snapshot v"+snapshot.version+" matches this device"):" · no remote snapshot yet");
        if(!snapshot){githubSyncQueued=true;void flushGitHubSnapshot();}
        render();
      }catch(error){
        githubStore=null;githubAuthority=null;githubSnapshotVersion=null;
        clearGitHubConnection({storage:githubSettingsStorage});
        status="GitHub reconnection failed: "+(error?.message||"Reconnect in Settings.");
        render();
      }
    })();
  }
  root.classList?.add("workspace-root");
  const legacy=document.querySelector(".shell");if(legacy)legacy.hidden=true;
  const notice=document.querySelector(".previewNotice");if(notice)notice.hidden=true;
  render();
  if(typeof globalThis.setInterval==="function"){
    refreshInterval=globalThis.setInterval(()=>{
      if(view!=="daily")return;
      const day=currentDay();
      if(day.start&&!day.stop&&selectedDate===getLocalDate())render();
    },30000);
    refreshInterval?.unref?.();
  }
  return {render,getState:()=>state,getSelectedDate:()=>selectedDate,getView:()=>view,dispose:()=>{disposeBinding();if(WORKSPACE_BINDINGS.get(root))WORKSPACE_BINDINGS.delete(root);},
    selectDate:date=>{selectedWeek=weekStartFor(date);selectedDate=date;ensureWeek();render();},
    setView:value=>{view=value;render();},save:()=>persist()};
}
