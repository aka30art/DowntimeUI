import {createId} from "./config-core.js";
import {calculateDayMetrics,calculateWeekMetrics,getEntryDurationMinutes,validateDowntimeEntry} from "./domain/downtime.js";
import {saveAndLockDailyTasks,setTaskCompletion,visibleDailyTasks,completedTaskCount,createDailyTaskState} from "./domain/daily-tasks.js";
import {calculateScheduleForDate,formatMinutes} from "./domain/schedule.js";
import {buildWeeklyReport} from "./domain/reports.js";

const STORE_PREFIX="downtimeui:operations:v1:";
const DAY_NAMES=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_CODES=["mon","tue","wed","thu","fri","sat"];
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const localIso=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
const fromIso=value=>new Date(value+"T12:00:00");
const weekStartFor=value=>{const date=typeof value==="string"?fromIso(value):new Date(value);date.setHours(12,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return date;};
const addDays=(date,count)=>{const value=new Date(date);value.setDate(value.getDate()+count);return value;};
const dayName=value=>DAY_NAMES[(fromIso(value).getDay()+6)%7];
const keyFor=installationId=>STORE_PREFIX+installationId;
function makeEmptyOperations(installationId){return {schemaVersion:1,installationId,weeks:{},reports:[],updatedAt:null};}
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
    return {state:{...empty,...parsed,weeks:parsed.weeks||{},reports:Array.isArray(parsed.reports)?parsed.reports:[]},error:null};
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
  anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}
function labelForDay(date){
  const dateObject=fromIso(date);
  return {name:DAY_NAMES[(dateObject.getDay()+6)%7],short:DAY_NAMES[(dateObject.getDay()+6)%7].slice(0,3).toUpperCase(),date:dateObject.toLocaleDateString("en-GB",{day:"2-digit",month:"short"})};
}
function scheduleLabel(date,schedule){
  const result=calculateScheduleForDate(date,schedule);
  return result.shifts.map(item=>Math.floor(item.startMinute/60).toString().padStart(2,"0")+":"+String(item.startMinute%60).padStart(2,"0")+"–"+Math.floor(item.endMinute%1440/60).toString().padStart(2,"0")+":"+String(item.endMinute%60).padStart(2,"0"));
}
export function mountWorkspace(root,config,{onEditConfiguration=()=>{},onExportConfiguration=()=>{} }={},options={}){
  if(!root)throw new Error("Workspace mount point is required.");
  if(!config?.installed||!config.installationId)throw new Error("A validated installed workspace is required.");
  const storage=options.storage||globalThis.localStorage;
  const loaded=readOperations(storage,config.installationId);
  let state=loaded.state,view="daily",selectedWeek=weekStartFor(new Date()),selectedDate=localIso(new Date()),status=loaded.error||"Local workspace ready.";
  function getWeekKey(){return localIso(selectedWeek);}
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
  function currentMetrics(){return calculateDayMetrics(currentDay(),config.schedule);}
  function weekMetrics(key=getWeekKey()){
    const monday=fromIso(key),week=state.weeks[key]||{days:Array.from({length:7},(_,i)=>makeDay(localIso(addDays(monday,i)),config))};
    return calculateWeekMetrics(week.days,config.schedule);
  }
  function persist(message="Saved on this device."){
    const result=saveOperations(storage,state);
    status=result.ok?message:"Save failed: "+result.error;
    return result.ok;
  }
  function nav(){
    return [["daily","Daily sheet"],["tasks","Daily tasks"],["weekly","Weekly summary"],["reports","Reports"],["people","People & settings"]].map(([id,name])=>'<button type="button" class="workspace-nav '+(view===id?"active":"")+'" data-view="'+id+'">'+name+'</button>').join("");
  }
  function metricCard(label,value,sub=""){
    return '<article class="workspace-metric"><span>'+label+'</span><strong>'+value+'</strong>'+(sub?'<small>'+sub+'</small>':'')+'</article>';
  }
  function renderDaily(){
    const week=ensureWeek(),metrics=currentMetrics(),day=currentDay(),selectedSchedule=scheduleLabel(selectedDate,config.schedule);
    const kpis=[["NET AVAILABLE",formatMinutes(metrics.netMinutes)],["DOWNTIME",formatMinutes(metrics.downtimeMinutes)],["RUNNING",formatMinutes(metrics.runningMinutes)],["DOWNTIME RATE",metrics.downtimeRate.toFixed(1)+"%"]];
    const days=week.days.map(item=>{
      const m=calculateDayMetrics(item,config.schedule),d=labelForDay(item.date);
      return '<button type="button" data-day="'+item.date+'" class="workspace-day '+(item.date===selectedDate?"selected":"")+'"><b>'+d.short+'</b><span>'+d.date+'</span><small>'+formatMinutes(m.downtimeMinutes)+'</small>'+(item.dailyTasks?.lockedAt?'<i>LOCKED</i>':'')+'</button>';
    }).join("");
    const people=Array.isArray(config.staff)?config.staff:[];
    const entries=day.entries.length?day.entries.map((entry,index)=>'<div class="workspace-entry"><div class="workspace-entry-copy"><b>'+esc(entry.area)+'</b><span>'+esc(entry.reason)+(entry.stationId?" · "+esc(config.site.stations.find(x=>x.id===entry.stationId)?.name||"Station"):"")+'</span></div><strong>'+formatMinutes(getEntryDurationMinutes(entry))+'</strong><button type="button" data-action="delete-entry" data-entry-id="'+esc(entry.id)+'" aria-label="Delete downtime entry '+(index+1)+'">×</button></div>').join(""):'<div class="workspace-empty">No downtime has been recorded for this day.</div>';
    const areaOptions=(config.site.areas||[]).map(x=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join("");
    const stationOptions=(config.site.stations||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
    const reasonOptions=(config.downtime.reasons||[]).map(x=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join("");
    const operatorOptions=people.map(x=>'<option value="'+esc(x.id)+'" '+(day.operatorId===x.id?"selected":"")+'>'+esc(x.name)+'</option>').join("");
    return '<section class="workspace-section">'+
      '<div class="workspace-section-head"><div><div class="workspace-eyebrow">DAILY OPERATIONS</div><h1>'+esc(dayName(selectedDate))+'</h1><p>'+fromIso(selectedDate).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})+'</p></div><div class="workspace-day-lock">'+(day.dailyTasks?.lockedAt?'<span>DAILY TASKS LOCKED</span>':'<span>DAILY TASKS OPEN</span>')+'</div></div>'+
      '<div class="workspace-daystrip">'+days+'</div>'+
      '<div class="workspace-metrics">'+kpis.map(x=>metricCard(x[0],x[1])).join("")+'</div>'+
      '<div class="workspace-two-col"><div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Downtime entries</h2><p>Record time lost against an area and reason.</p></div><span class="workspace-count">'+day.entries.length+' ENTRIES</span></div>'+
      '<div class="workspace-entry-list">'+entries+'</div>'+
      '<div class="workspace-add-form"><h3>Add downtime entry</h3><div class="workspace-form-grid">'+
      '<label><span>Area / location *</span><input name="entry-area" list="workspace-areas" placeholder="Enter or select an area"></label><datalist id="workspace-areas">'+areaOptions+'</datalist>'+
      '<label><span>Station (optional)</span><select name="entry-station"><option value="">No station selected</option>'+stationOptions+'</select></label>'+
      '<label class="workspace-full"><span>Reason *</span><input name="entry-reason" list="workspace-reasons" placeholder="Enter or select a reason"></label><datalist id="workspace-reasons">'+reasonOptions+'</datalist>'+
      '<label><span>Hours</span><input name="entry-hours" type="number" min="0" max="999" step="1" value="0"></label>'+
      '<label><span>Minutes</span><input name="entry-minutes" type="number" min="0" max="59" step="1" value="0"></label></div>'+
      '<div class="workspace-form-actions"><span>Entry is saved to this browser only.</span><button type="button" class="workspace-primary" data-action="save-entry">Save downtime</button></div><div class="workspace-message" role="status">'+esc(status)+'</div></div></div>'+
      '<aside class="workspace-panel"><div class="workspace-panel-head"><div><h2>Shift summary</h2><p>Configured site schedule for this date.</p></div></div>'+
      '<div class="workspace-schedule-line"><span>Shift window</span><strong>'+(selectedSchedule.length?selectedSchedule.map(esc).join("<br>"):"Not configured")+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Break deduction</span><strong>'+formatMinutes(metrics.breakMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Scheduled time</span><strong>'+formatMinutes(metrics.scheduledMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Net available</span><strong>'+formatMinutes(metrics.netMinutes)+'</strong></div>'+
      '<div class="workspace-schedule-line"><span>Operator on duty</span><strong>'+(people.length?esc(people.find(x=>x.id===day.operatorId)?.name||"Not assigned"):"Not configured")+'</strong></div>'+
      '<label class="workspace-operator"><span>Assign operator</span><select data-operator><option value="">Not assigned</option>'+operatorOptions+'</select></label>'+
      (metrics.exceedsNetTime?'<div class="workspace-alert">Recorded downtime exceeds net available time. Check the entry durations.</div>':'')+
      '<div class="workspace-inline-actions"><button type="button" data-view="tasks">Open daily tasks</button><button type="button" data-view="weekly">View weekly summary</button></div></aside></div></section>';
  }
  function renderTasks(){
    const day=currentDay(),templates=Array.isArray(config.dailyTasks)?config.dailyTasks:[],locked=Boolean(day.dailyTasks?.lockedAt);
    const tasks=visibleDailyTasks(day.dailyTasks,templates),done=new Set(day.dailyTasks?.completedTaskIds||[]);
    const count=completedTaskCount({...day.dailyTasks,snapshot:locked?day.dailyTasks.snapshot:templates});
    const rows=tasks.map(task=>'<label class="workspace-task '+(done.has(task.id)?"done":"")+'"><input type="checkbox" data-task="'+esc(task.id)+'" '+(done.has(task.id)?"checked":"")+(locked?" disabled":"")+'><span>'+esc(task.name)+'</span></label>').join("");
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">DAILY CONTROL</div><h1>Daily tasks</h1><p class="workspace-lead">Checklist for '+esc(dayName(selectedDate))+' · '+esc(selectedDate)+'. Save and lock to freeze this exact checklist for the selected day.</p>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Task checklist</h2><p>'+(locked?"This day's task snapshot is immutable.":"Mark completed tasks, then save and lock for the day.")+'</p></div><span class="workspace-count">'+count+' / '+tasks.length+' COMPLETE</span></div>'+
      '<div class="workspace-progress"><span style="width:'+(tasks.length?count/tasks.length*100:0)+'%"></span></div>'+
      (tasks.length?'<div class="workspace-task-list">'+rows+'</div>':'<div class="workspace-empty">No daily task templates are configured. Add tasks in workspace setup.</div>')+
      (locked?'<div class="workspace-lock-banner"><b>Saved and locked</b><span>Locked '+esc(new Date(day.dailyTasks.lockedAt).toLocaleString("en-GB"))+'. This checklist cannot be edited.</span></div>':'<div class="workspace-task-actions"><span>Changes are stored locally before the lock is applied.</span><button type="button" class="workspace-primary" data-action="lock-tasks" '+(!tasks.length?"disabled":"")+'>SAVE &amp; LOCK FOR TODAY</button></div>')+
      '<div class="workspace-message" role="status">'+esc(status)+'</div></div></section>';
  }
  function renderWeekly(){
    const week=ensureWeek(),metrics=weekMetrics(),days=week.days.map(day=>({day,metrics:calculateDayMetrics(day,config.schedule)}));
    const body=days.map(({day,metrics:m})=>'<tr><td>'+esc(dayName(day.date))+'</td><td>'+esc(day.operatorId?config.staff.find(x=>x.id===day.operatorId)?.name||"—":"—")+'</td><td>'+day.date+'</td><td>'+formatMinutes(m.netMinutes)+'</td><td>'+formatMinutes(m.downtimeMinutes)+'</td><td>'+formatMinutes(m.runningMinutes)+'</td><td>'+m.downtimeRate.toFixed(1)+'%</td><td>'+m.runningRate.toFixed(1)+'%</td></tr>').join("");
    return '<section class="workspace-section"><div class="workspace-eyebrow">PERFORMANCE</div><h1>Weekly summary</h1><p class="workspace-lead">'+selectedWeek.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+' — '+addDays(selectedWeek,6).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+'</p>'+
      '<div class="workspace-week-nav"><button type="button" data-action="previous-week">← Previous week</button><button type="button" data-action="current-week">Current week</button><button type="button" data-action="next-week">Next week →</button></div>'+
      '<div class="workspace-metrics">'+metricCard("NET AVAILABLE",formatMinutes(metrics.netMinutes))+metricCard("WEEKLY DOWNTIME",formatMinutes(metrics.downtimeMinutes))+metricCard("RUNNING",formatMinutes(metrics.runningMinutes))+metricCard("DOWNTIME RATE",metrics.downtimeRate.toFixed(1)+"%")+'</div>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Day-by-day performance</h2><p>Weekly rates use aggregate minutes, not an average of daily percentages.</p></div></div><div class="workspace-table-wrap"><table><thead><tr><th>Day</th><th>Operator</th><th>Date</th><th>Net</th><th>Downtime</th><th>Running</th><th>Downtime %</th><th>Running %</th></tr></thead><tbody>'+body+'</tbody></table></div></div></section>';
  }
  function renderReports(){
    const reports=state.reports.slice().sort((a,b)=>String(b.generatedAt).localeCompare(String(a.generatedAt)));
    const rows=reports.map(report=>'<article class="workspace-report-row"><div><b>Week starting '+esc(report.weekStart||"—")+'</b><small>'+esc(report.siteName||config.site.siteName)+' · '+formatMinutes(report.totals?.downtimeMinutes||0)+' downtime · '+Number(report.totals?.downtimeRate||0).toFixed(1)+'%</small></div><div><button type="button" data-action="print-report" data-report-id="'+esc(report.id)+'">Print / PDF</button><button type="button" data-action="export-report" data-report-id="'+esc(report.id)+'">Export JSON</button></div></article>').join("");
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">ARCHIVE</div><h1>Weekly reports</h1><p class="workspace-lead">Generate a dated report snapshot from the selected week. Browser print supports saving a PDF.</p>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Report archive</h2><p>Stored locally with this workspace.</p></div><button type="button" class="workspace-primary" data-action="generate-report">Generate report</button></div>'+
      (rows||'<div class="workspace-empty">No reports generated yet.</div>')+'</div></section>';
  }
  function renderPeople(){
    const staff=(config.staff||[]).map(item=>'<div class="workspace-person"><span>'+esc(item.name)+'</span><small>STAFF ROSTER</small></div>').join("");
    const areas=(config.site.areas||[]).map(item=>'<span class="workspace-chip">'+esc(item.name)+'</span>').join("")||'<span class="workspace-muted">No areas configured</span>';
    const stations=(config.site.stations||[]).map(item=>'<span class="workspace-chip">'+esc(item.name)+'</span>').join("")||'<span class="workspace-muted">No stations configured</span>';
    const reasons=(config.downtime.reasons||[]).map(item=>'<span class="workspace-chip">'+esc(item.name)+'</span>').join("")||'<span class="workspace-muted">No downtime reasons configured</span>';
    const tasks=(config.dailyTasks||[]).map(item=>'<span class="workspace-chip">'+esc(item.name)+'</span>').join("")||'<span class="workspace-muted">No daily task templates configured</span>';
    return '<section class="workspace-section workspace-narrow"><div class="workspace-eyebrow">WORKSPACE CONFIGURATION</div><h1>People & settings</h1><p class="workspace-lead">Company-specific setup can be changed at any time. This local installation does not provide secure user accounts or server-side role enforcement.</p>'+
      '<div class="workspace-panel"><div class="workspace-panel-head"><div><h2>Company identity</h2><p>Workspace identity and location.</p></div><button type="button" data-action="edit-config">Edit configuration</button></div><div class="workspace-config-pair"><span>Company</span><b>'+esc(config.identity.companyName)+'</b></div><div class="workspace-config-pair"><span>Site</span><b>'+esc(config.site.siteName)+'</b></div><div class="workspace-config-pair"><span>Time zone</span><b>'+esc(config.identity.timezone)+'</b></div></div>'+
      '<div class="workspace-panel"><h2>Staff roster</h2><div class="workspace-chip-list">'+(staff||'<span class="workspace-muted">No staff configured</span>')+'</div></div>'+
      '<div class="workspace-panel"><h2>Areas and stations</h2><div class="workspace-config-pair"><span>Areas</span><div class="workspace-chip-list">'+areas+'</div></div><div class="workspace-config-pair"><span>Stations</span><div class="workspace-chip-list">'+stations+'</div></div></div>'+
      '<div class="workspace-panel"><h2>Downtime and daily tasks</h2><div class="workspace-config-pair"><span>Reasons</span><div class="workspace-chip-list">'+reasons+'</div></div><div class="workspace-config-pair"><span>Task templates</span><div class="workspace-chip-list">'+tasks+'</div></div></div>'+
      '<div class="workspace-panel"><h2>Local data controls</h2><p class="workspace-muted">Operational records and reports are stored in this browser, isolated by this installation ID.</p><div class="workspace-button-row"><button type="button" data-action="export-backup">Export full workspace backup</button><button type="button" data-action="export-config">Export configuration JSON</button></div></div></section>';
  }
  function render(){
    const week=ensureWeek();
    const content=view==="daily"?renderDaily():view==="tasks"?renderTasks():view==="weekly"?renderWeekly():view==="reports"?renderReports():renderPeople();
    root.innerHTML='<div class="workspace-app"><header class="workspace-header"><div class="workspace-brand"><span class="workspace-brand-mark">D</span><div><b>'+esc(config.identity.companyName)+'</b><small>'+esc(config.site.siteName)+' · DOWNTIMEUI</small></div></div><div class="workspace-header-actions"><span class="workspace-local-tag">LOCAL MODE · SINGLE DEVICE</span><button type="button" data-action="export-backup">Backup</button></div></header>'+
      '<nav class="workspace-navigation">'+nav()+'</nav><div class="workspace-content">'+content+'</div><footer class="workspace-footer"><span>'+esc(status)+'</span><span>Data is stored in this browser. Shared access and server sync are not active.</span></footer></div>';
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
    const entry={id:createId("entry"),area:findField("entry-area").trim(),stationId:findField("entry-station")||null,reason:findField("entry-reason").trim(),
      hours:Number(findField("entry-hours"))||0,minutes:Number(findField("entry-minutes"))||0,createdAt:new Date().toISOString()};
    const errors=validateDowntimeEntry(entry);
    if(errors.length){status=errors.join(" ");render();return;}
    currentDay().entries.push(entry);
    if(persist("Downtime entry saved locally."))render();
  }
  function generateReport(){
    const week=ensureWeek(),previousKey=localIso(addDays(selectedWeek,-7)),previous=state.weeks[previousKey]?.days||[];
    const report=buildWeeklyReport({weekStart:getWeekKey(),days:week.days,previousDays:previous,schedule:config.schedule,companyName:config.identity.companyName,siteName:config.site.siteName});
    report.id=createId("report");state.reports.push(report);
    if(persist("Weekly report snapshot created.")){view="reports";render();}
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
    fileDownload("downtimeui-workspace-backup.json","application/json",JSON.stringify({configuration:config,operations:state,exportedAt:new Date().toISOString()},null,2));
  }
  root.addEventListener("click",event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.view){view=button.dataset.view;render();return;}
    if(button.dataset.day){selectedDate=button.dataset.day;render();return;}
    const action=button.dataset.action;if(!action)return;
    if(action==="save-entry")saveEntry();
    else if(action==="delete-entry"){
      currentDay().entries=currentDay().entries.filter(x=>x.id!==button.dataset.entryId);
      if(persist("Downtime entry removed."))render();
    }
    else if(action==="lock-tasks"){
      const day=currentDay(),before=day.dailyTasks;
      const result=saveAndLockDailyTasks(before,config.dailyTasks||[],{actorId:null,now:new Date()});
      if(!result.ok){status=result.errors.join(" ");render();return;}
      day.dailyTasks=result.state;
      if(persist("Daily tasks saved and locked for this day."))render();else day.dailyTasks=before;
    }
    else if(action==="previous-week")selectedWeekMove(-1);
    else if(action==="next-week")selectedWeekMove(1);
    else if(action==="current-week"){selectedWeek=weekStartFor(new Date());selectedDate=localIso(selectedWeek);ensureWeek();render();}
    else if(action==="generate-report")generateReport();
    else if(action==="print-report"||action==="export-report"){
      const report=state.reports.find(x=>x.id===button.dataset.reportId);
      if(action==="print-report")printReport(report);else downloadReport(report);
    }
    else if(action==="export-backup")exportBackup();
    else if(action==="export-config")onExportConfiguration();
    else if(action==="edit-config")editConfig();
  });
  root.addEventListener("change",event=>{
    const control=event.target;
    if(control.matches("[data-task]")){
      const day=currentDay(),result=setTaskCompletion(day.dailyTasks,control.dataset.task,control.checked,config.dailyTasks||[]);
      if(!result.ok){status=result.message;render();return;}
      day.dailyTasks=result.state;
      if(!persist("Task completion saved locally.")){day.dailyTasks=createDailyTaskState();render();return;}
      render();
    } else if(control.matches("[data-operator]")){
      currentDay().operatorId=control.value||"";
      if(persist("Operator assignment saved locally."))render();
    }
  });
  selectedWeek=weekStartFor(selectedDate);
  ensureWeek();
  root.classList?.add("workspace-root");
  const legacy=document.querySelector(".shell");if(legacy)legacy.hidden=true;
  const notice=document.querySelector(".previewNotice");if(notice)notice.hidden=true;
  render();
  return {render,getState:()=>state,getSelectedDate:()=>selectedDate,getView:()=>view,
    selectDate:date=>{selectedWeek=weekStartFor(date);selectedDate=date;ensureWeek();render();},
    setView:value=>{view=value;render();},save:()=>persist()};
}
