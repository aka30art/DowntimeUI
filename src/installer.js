import {
  cloneDefaultConfig, createId, createTenantConfig, activateInstall, validateConfig,
  saveDraft, loadDraft, saveInstalledConfig, loadInstalledConfig
} from "./config-core.js";
import { mountWorkspace } from "./workspace.js";
import { restoreWorkspaceBackup, validateWorkspaceBackup } from "./domain/backup.js";

const root = document.getElementById("installerRoot");
if (!root) throw new Error("DOWNTIMEUI installer mount point is missing.");
const steps = ["Welcome","Company","Site structure","Downtime reasons","Schedule","Staff","Access roles","Daily tasks","Review"];
const days = [["mon","Monday"],["tue","Tuesday"],["wed","Wednesday"],["thu","Thursday"],["fri","Friday"],["sat","Saturday"],["sun","Sunday"]];
const perms = [["view","View operational data"],["recordDowntime","Record downtime"],["editRecords","Edit records"],["manageSettings","Manage settings"],["manageUsers","Manage users"],["exportReports","Export reports"]];
const active = loadInstalledConfig(), draft = loadDraft();
let installed = Boolean(active.ok && active.value);
let config = installed ? active.value : (draft.ok && draft.value ? draft.value : cloneDefaultConfig());
let step = Math.min(8, Math.max(0, Number(config.setup?.currentStep) || 0));
let screen = installed ? "installed" : "wizard";
let saveMessage = "Progress is saved locally as you work.";
if (!config.identity.timezone) {
  try { config.identity.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { config.identity.timezone = "UTC"; }
}
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pathValue = p => p.split(".").reduce((v,k) => v?.[k], config);
function setPath(p,v) { const a=p.split("."), last=a.pop(), obj=a.reduce((x,k)=>x?.[k],config); if(obj && last!==undefined)obj[last]=v; }
function field(label,path,value,placeholder,type) {
  return '<label class="setup-field"><span>'+esc(label)+'</span><input type="'+(type||"text")+'" data-path="'+esc(path)+'" value="'+esc(value)+'" placeholder="'+esc(placeholder||"")+'" autocomplete="off"></label>';
}
function selectField(label,path,value,opts) {
  return '<label class="setup-field"><span>'+esc(label)+'</span><select data-path="'+esc(path)+'">'+opts.map(o=>'<option value="'+esc(o[0])+'" '+(o[0]===value?'selected':'')+'>'+esc(o[1])+'</option>').join("")+'</select></label>';
}
function title(kicker,heading,intro) { return '<div class="setup-kicker">'+kicker+'</div><h1>'+heading+'</h1><p class="setup-intro">'+intro+'</p>'; }
function add(type,label) { return '<button type="button" class="setup-add" data-action="add-'+type+'">+ '+label+'</button>'; }
function remove(type,i) { return '<button type="button" class="setup-remove" data-action="remove-'+type+'" data-index="'+i+'">Remove</button>'; }
function staffRows(){
  return config.staff.map((member,index)=>{
    const preview=member.photoDataUrl
      ?'<img src="'+esc(member.photoDataUrl)+'" alt="'+esc(member.name||"Staff photo")+'">'
      :'<span>'+esc((member.name||"").trim().split(/\\s+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join("")||"—")+'</span>';
    return '<div class="setup-staff-row"><div class="setup-staff-name">'+field("Staff member","staff."+index+".name",member.name,"Full name")+'</div>'+
      '<div class="setup-staff-photo"><div class="setup-staff-preview">'+preview+'</div><label><span>Profile photo (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" data-staff-photo="'+index+'"></label>'+
      (member.photoDataUrl?'<button type="button" class="setup-photo-remove" data-action="remove-staff-photo" data-index="'+index+'">Remove photo</button>':'')+'</div>'+
      remove("staff",index)+'</div>';
  }).join("") || '<div class="setup-empty">No staff added. You can create the roster later in Settings.</div>';
}
async function compressStaffPhoto(file){
  if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Choose a JPEG, PNG or WebP image.");
  if(file.size>8*1024*1024)throw new Error("Original image must be 8 MB or smaller.");
  const source=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("The selected image could not be read."));
    reader.onload=()=>resolve(String(reader.result||""));
    reader.readAsDataURL(file);
  });
  const image=await new Promise((resolve,reject)=>{
    const value=new Image();
    value.onload=()=>resolve(value);
    value.onerror=()=>reject(new Error("The selected file is not a valid image."));
    value.src=source;
  });
  const size=320,scale=Math.min(size/image.width,size/image.height);
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
  const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
  const context=canvas.getContext("2d");
  if(!context)throw new Error("Image compression is unavailable in this browser.");
  context.fillStyle="#172b38";context.fillRect(0,0,size,size);
  context.drawImage(image,Math.round((size-width)/2),Math.round((size-height)/2),width,height);
  const result=canvas.toDataURL("image/jpeg",0.72);
  if(result.length>180000)throw new Error("Compressed profile photo is still too large. Choose a simpler or smaller image.");
  return result;
}
function itemRows(arr,path,type,label,placeholder) {
  return arr.map((x,i)=>'<div class="setup-list-row">'+field(label,path+'.'+i+'.name',x.name,placeholder)+remove(type,i)+'</div>').join("") || '<div class="setup-empty">Nothing added yet. This section can be completed later in Settings.</div>';
}
function shiftRows(arr,path,type,titleLabel) {
  return arr.map((x,i)=>'<div class="setup-shift-row"><div>'+field(titleLabel,path+'.'+i+'.name',x.name,"Name")+'</div><div>'+field("Start",path+'.'+i+'.start',x.start,"06:30","time")+'</div><div>'+field("End",path+'.'+i+'.end',x.end,"15:00","time")+'</div>'+remove(type,i)+'</div>').join("") || '<div class="setup-empty">No '+titleLabel.toLowerCase()+' periods configured.</div>';
}
function content(errors) {
  if(step===0) return title("FIRST-RUN INSTALLATION","Set up your workspace.","DOWNTIMEUI begins with a clean configuration. Define the structure and rules used by your organisation; optional sections can be completed later.")+
    '<div class="setup-welcome-grid"><div class="setup-welcome-card"><span class="setup-number">01</span><strong>Company identity</strong><p>Company, language and local time zone.</p></div><div class="setup-welcome-card"><span class="setup-number">02</span><strong>Site structure</strong><p>Site, areas and stations configured to your operation.</p></div><div class="setup-welcome-card"><span class="setup-number">03</span><strong>Operating rules</strong><p>Reasons, shifts, staff, permissions and task templates.</p></div></div><div class="setup-note"><b>Empty by default</b><span>No company, operator, plant, station or downtime data has been pre-filled.</span></div><div class="setup-restore-option"><div><b>Already have a workspace backup?</b><p>Restore a previously exported DOWNTIMEUI backup onto this clean installation.</p></div><button type="button" data-action="choose-restore">Restore backup JSON</button><input type="file" accept=".json,application/json" data-initial-backup hidden></div>';
  if(step===1) return title("STEP 01 / 08","Company identity","Identify the organisation using this workspace. These values can be changed after installation.")+
    '<div class="setup-form-grid">'+field("Company name *","identity.companyName",config.identity.companyName,"Enter company name")+
    field("Language / regional format","identity.locale",config.identity.locale,"en-GB")+
    field("Time zone *","identity.timezone",config.identity.timezone,"e.g. Europe/London")+
    field("Company logo URL (optional)","identity.logoUrl",config.identity.logoUrl,"https://…")+'</div><div class="setup-note"><b>Logo guidance</b><span>Use an HTTPS image URL. Local file upload and managed brand assets will be handled in the Settings module.</span></div>';
  if(step===2) {
    const areas=config.site.areas.map((x,i)=>'<div class="setup-list-row">'+field("Area name","site.areas."+i+".name",x.name,"e.g. Production")+remove("area",i)+'</div>').join("")||'<div class="setup-empty">No areas added. You can add them later in Settings.</div>';
    const stations=config.site.stations.map((x,i)=>'<div class="setup-list-row setup-station-row">'+field("Station name","site.stations."+i+".name",x.name,"e.g. Line 1")+selectField("Area","site.stations."+i+".areaId",x.areaId||"",[["","Unassigned"],...config.site.areas.map(a=>[a.id,a.name||"Unnamed area"])])+remove("station",i)+'</div>').join("")||'<div class="setup-empty">No stations added. You can add them later in Settings.</div>';
    return title("STEP 02 / 08","Site and structure","Define the physical or operational hierarchy used by this site.")+
      '<div class="setup-form-grid">'+field("Site / plant name *","site.siteName",config.site.siteName,"e.g. Main facility")+
      field("First hierarchy label","site.hierarchy.0",config.site.hierarchy[0],"Area")+
      field("Second hierarchy label","site.hierarchy.1",config.site.hierarchy[1],"Station")+'</div>'+
      '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Areas</h2><p>Locations or departments within the site.</p></div>'+add("area","Add area")+'</div>'+areas+'</div>'+
      '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Stations</h2><p>Workstations, lines, machines or operational points.</p></div>'+add("station","Add station")+'</div>'+stations+'</div>';
  }
  if(step===3) return title("STEP 03 / 08 · OPTIONAL","Downtime reasons","Create the reason library staff will use when recording downtime. The list starts empty.")+
    '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Reason library</h2><p>Use names that match your operation.</p></div>'+add("reason","Add reason")+'</div>'+itemRows(config.downtime.reasons,"downtime.reasons","reason","Reason name","e.g. Mechanical fault")+'</div>';
  if(step===4) return title("STEP 04 / 08 · OPTIONAL","Operating schedule","Define working days, shift windows and break periods for time calculations.")+
    '<div class="setup-subsection"><h2>Operating days</h2><p>Select the days on which this site normally operates.</p><div class="setup-days">'+days.map(d=>'<label class="setup-day"><input type="checkbox" data-day="'+d[0]+'" '+(config.schedule.workDays.includes(d[0])?"checked":"")+'><span>'+d[1]+'</span></label>').join("")+'</div></div>'+
    '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Shifts</h2><p>Times use the selected time zone. An end time earlier than the start time represents an overnight period.</p></div>'+add("shift","Add shift")+'</div>'+shiftRows(config.schedule.shifts,"schedule.shifts","shift","Shift name")+'</div>'+
    '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Break periods</h2><p>Breaks are defined separately for reporting and calculations.</p></div>'+add("break","Add break")+'</div>'+shiftRows(config.schedule.breaks,"schedule.breaks","break","Break name")+'</div>';
  if(step===5) return title("STEP 05 / 08 · OPTIONAL","Staff and operators","Add the roster used for station assignments. Profile photos are compressed and saved locally with this browser workspace.")+
    '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Staff roster</h2><p>Names and optional profile photos. Adding a staff member does not create a login account.</p></div>'+add("staff","Add person")+'</div>'+staffRows()+'</div>'+
    '<div class="setup-note"><b>Account security</b><span>Do not enter PINs or passwords here. Authentication and account provisioning are separate work. Photos remain in this browser until a secure private file-storage service is implemented.</span></div>';
  if(step===6) {
    const roles=config.roles.map((x,i)=>'<div class="setup-role"><div class="setup-role-head">'+field("Role name","roles."+i+".name",x.name,"e.g. Supervisor")+remove("role",i)+'</div><div class="setup-permissions">'+perms.map(p=>'<label><input type="checkbox" data-path="roles.'+i+'.permissions.'+p[0]+'" '+(x.permissions?.[p[0]]?"checked":"")+'><span>'+p[1]+'</span></label>').join("")+'</div></div>').join("")||'<div class="setup-empty">No roles defined. You can configure access later.</div>';
    return title("STEP 06 / 08 · OPTIONAL","Access roles","Define the permission groups your organisation needs. Server-side enforcement and user assignment are not part of this installer.")+
      '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Role definitions</h2><p>Choose the capabilities each role should receive.</p></div>'+add("role","Add role")+'</div>'+roles+'</div>';
  }
  if(step===7) return title("STEP 07 / 08 · OPTIONAL","Daily task templates","Create reusable task names for the daily checklist. Operators can complete these tasks each day; SAVE & LOCK freezes the checklist for that date.")+
    '<div class="setup-subsection"><div class="setup-subhead"><div><h2>Task templates</h2><p>Only reusable task titles are configured here.</p></div>'+add("task","Add task")+'</div>'+itemRows(config.dailyTasks,"dailyTasks","task","Task title","e.g. Safety inspection")+'</div>';
  const summary=[["Company",config.identity.companyName||"Not set"],["Site",config.site.siteName||"Not set"],["Areas / stations",config.site.areas.length+" / "+config.site.stations.length],["Downtime reasons",config.downtime.reasons.length],["Operating days",config.schedule.workDays.length],["Shifts / breaks",config.schedule.shifts.length+" / "+config.schedule.breaks.length],["Staff",config.staff.length],["Roles",config.roles.length],["Daily task templates",config.dailyTasks.length]];
  return title("STEP 08 / 08","Review before installation","Required fields must be valid. Optional lists can remain empty and be completed later.")+
    '<div class="setup-review">'+summary.map(x=>'<div><span>'+x[0]+'</span><strong>'+esc(x[1])+'</strong></div>').join("")+'</div>'+
    '<div class="setup-note"><b>Storage boundary</b><span>This installer saves to this browser only. No cloud database, user authentication, shared persistence or cross-device sync is connected.</span></div>'+
    (errors?.length?'<div class="setup-errors" role="alert"><b>Resolve these items before installation</b><ul>'+errors.map(e=>'<li>'+esc(e)+'</li>').join("")+'</ul></div>':'<div class="setup-ready"><b>Required configuration looks complete.</b><span>Installation will validate it again before saving.</span></div>');
}
function renderWizard(errors) {
  root.innerHTML='<div class="setup-backdrop"><div class="setup-app"><header class="setup-header"><div class="setup-brand"><span class="setup-brand-mark">D</span><div><b>DOWNTIMEUI</b><small>UNIVERSAL WORKSPACE SETUP</small></div></div><div class="setup-header-meta"><span class="setup-status-dot"></span>'+(installed?"Configuration editor":"New installation")+'</div></header>'+
    '<div class="setup-layout"><aside class="setup-sidebar"><div><div class="setup-sidebar-label">INSTALLATION</div><div class="setup-step-list">'+steps.map((x,i)=>'<button type="button" data-goto="'+i+'" class="'+(step===i?"current ":"")+(config.setup.completedSteps.includes(i)?"complete":"")+'"><span>'+String(i).padStart(2,"0")+'</span><b>'+x+'</b>'+(config.setup.completedSteps.includes(i)?'<i>✓</i>':'')+'</button>').join("")+'</div></div><div class="setup-sidebar-foot"><span>CONFIGURATION '+(installed?"EDITOR":"WIZARD")+'</span><small>Progress is saved locally as you work.</small></div></aside>'+
    '<main class="setup-main"><div class="setup-main-top"><span>'+(step===0?"WELCOME":"STEP "+String(step).padStart(2,"0")+" / 08")+'</span><span>'+(installed?"EDITING ACTIVE LOCAL CONFIGURATION":"NEW INSTALLATION · EMPTY BY DEFAULT")+'</span></div><section class="setup-content" aria-live="polite">'+content(errors)+'</section>'+
    '<footer class="setup-footer"><div class="setup-save-state" id="setupSaveState">'+esc(saveMessage)+'</div><div class="setup-actions"><button type="button" class="setup-secondary" data-action="save-exit">Save and exit</button>'+(step>0?'<button type="button" class="setup-secondary" data-action="back">Back</button>':'')+(step<8?'<button type="button" class="setup-primary" data-action="next">'+(step===0?"Start setup":"Continue")+'<span>→</span></button>':'<button type="button" class="setup-primary" data-action="install">'+(installed?"Save configuration":"Install workspace")+'<span>✓</span></button>')+'</div></footer></main></div></div></div>';
}
function renderInstalled() {
  root.innerHTML='<div class="setup-backdrop"><div class="setup-complete"><div class="setup-complete-mark">✓</div><div class="setup-kicker">'+(installed?"LOCAL INSTALLATION FOUND":"SETUP SAVED")+'</div><h1>'+(installed?"Workspace configured.":"Your setup is saved.")+'</h1><p class="setup-intro">'+(installed?esc(config.identity.companyName)+" · "+esc(config.site.siteName):"Installation is not complete. Resume setup to validate and install this workspace.")+'</p>'+
    '<div class="setup-complete-card"><div><span>Company</span><strong>'+esc(config.identity.companyName||"Not configured")+'</strong></div><div><span>Site</span><strong>'+esc(config.site.siteName||"Not configured")+'</strong></div><div><span>Areas and stations</span><strong>'+config.site.areas.length+" / "+config.site.stations.length+'</strong></div><div><span>Downtime reasons</span><strong>'+config.downtime.reasons.length+'</strong></div></div>'+
    '<div class="setup-note"><b>Local-only installation</b><span>The installation and operational records are stored in this browser. This workspace supports local downtime records, plant status, daily task locking, weekly summaries and reports; shared multi-user storage, authentication and server-enforced permissions are not enabled.</span></div>'+
    '<div class="setup-complete-actions">'+(installed?'<button type="button" class="setup-primary" data-action="open-preview">Open workspace <span>→</span></button><button type="button" class="setup-secondary" data-action="edit-config">Edit configuration</button><button type="button" class="setup-secondary" data-action="export-config">Export configuration JSON</button>':'<button type="button" class="setup-primary" data-action="resume">Resume setup <span>→</span></button>')+'</div><div class="setup-fineprint">Configuration remains on this device until browser storage is cleared or the configuration is exported.</div></div></div>';
}
function saveDraftState() {
  if(installed)return;
  const r=saveDraft(config); saveMessage=r.ok?"Draft saved on this device.":"Local save unavailable: "+r.error;
  const n=document.getElementById("setupSaveState"); if(n)n.textContent=saveMessage;
}
function renderWorkspace(){
  mountWorkspace(root,config,{
    onEditConfiguration:(nextStep=1)=>{screen="wizard";step=Math.max(1,Math.min(7,Number(nextStep)||1));config.setup.currentStep=step;render();},
    onExportConfiguration:exportConfig,
    onRestoreConfiguration:(restoredConfig)=>{
      const errors=validateConfig(restoredConfig);
      if(errors.length)return {ok:false,error:errors.join(" ")};
      if(restoredConfig.installationId!==config.installationId)return {ok:false,error:"Backup installation ID does not match this workspace."};
      /* restoreWorkspaceBackup has already committed both local storage records atomically. */
      for(const key of Object.keys(config))delete config[key];
      Object.assign(config,JSON.parse(JSON.stringify(restoredConfig)));
      return {ok:true};
    }
  });
}
function render() { if(screen==="installed")renderInstalled(); else if(screen==="preview")renderWorkspace(); else renderWizard(); }

function addItem(type) {
  const base={
    area:{id:createId("area"),name:""},
    station:{id:createId("station"),name:"",areaId:""},
    reason:{id:createId("reason"),name:""},
    shift:{id:createId("shift"),name:"",start:"06:30",end:"15:00"},
    break:{id:createId("break"),name:"",start:"",end:""},
    staff:{id:createId("staff"),name:""},
    role:{id:createId("role"),name:"",permissions:Object.fromEntries(perms.map(p=>[p[0],false]))},
    task:{id:createId("task"),name:""}
  };
  const target={area:config.site.areas,station:config.site.stations,reason:config.downtime.reasons,shift:config.schedule.shifts,break:config.schedule.breaks,staff:config.staff,role:config.roles,task:config.dailyTasks}[type];
  target.push(base[type]);
}
function removeItem(type,index) {
  const target={area:config.site.areas,station:config.site.stations,reason:config.downtime.reasons,shift:config.schedule.shifts,break:config.schedule.breaks,staff:config.staff,role:config.roles,task:config.dailyTasks}[type];
  if(target&&index>=0&&index<target.length)target.splice(index,1);
}
function exportConfig() {
  const blob=new Blob([JSON.stringify(config,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="downtimeui-workspace-config.json";a.click();URL.revokeObjectURL(url);
}
function install() {
  const errors=validateConfig(config);
  if(errors.length){step=8;config.setup.currentStep=8;renderWizard(errors);return;}
  if(installed){
    config={...config,installed:true,setup:{...config.setup,currentStep:8,completedSteps:[...new Set([...config.setup.completedSteps,8])],updatedAt:new Date().toISOString()}};
  } else {
    const r=activateInstall(config); if(!r.ok){step=8;renderWizard(r.errors);return;} config=r.config;
  }
  const saved=saveInstalledConfig(config);
  if(!saved.ok){step=8;renderWizard([saved.error]);return;}
  installed=true;screen="installed";render();
}
root.addEventListener("input",e=>{
  const el=e.target;if(el.matches("[data-path]")){setPath(el.dataset.path,el.type==="checkbox"?el.checked:el.value);saveDraftState();}
});
async function restoreInitialBackup(file){
  if(!file)return;
  let backup;
  try{backup=JSON.parse(await file.text());}
  catch{saveMessage="Backup rejected: file is not valid JSON.";renderWizard([saveMessage]);return;}
  const backupInstallationId=backup?.configuration?.installationId;
  const validation=validateWorkspaceBackup(backup,backupInstallationId);
  if(!validation.ok){renderWizard(["Backup rejected: "+validation.errors.join(" ")]);return;}
  const company=backup.configuration.identity.companyName;
  const site=backup.configuration.site.siteName;
  if(typeof globalThis.confirm==="function"&&!globalThis.confirm("Restore the "+company+" · "+site+" workspace and its local records onto this clean installation?"))return;
  const restored=restoreWorkspaceBackup(backup,backupInstallationId,{storage:globalThis.localStorage});
  if(!restored.ok){renderWizard(["Backup restore failed: "+restored.errors.join(" ")]);return;}
  config=restored.configuration;
  installed=true;
  step=8;
  screen="installed";
  render();
}
root.addEventListener("change",async e=>{
  const el=e.target;
  if(el.matches("[data-staff-photo]")){
    const index=Number(el.dataset.staffPhoto),member=config.staff[index],file=el.files?.[0];
    if(!member||!file)return;
    try{
      member.photoDataUrl=await compressStaffPhoto(file);
      saveMessage="Profile photo compressed and saved to the local workspace.";
      saveDraftState();
      render();
    }catch(error){
      saveMessage=error?.message||"Profile photo could not be uploaded.";
      render();
    }
    return;
  }
  if(el.matches("[data-initial-backup]")){
    const file=el.files?.[0];
    if(file)await restoreInitialBackup(file);
    el.value="";
    return;
  }
  if(el.matches("[data-day]")){
    const day=el.dataset.day;config.schedule.workDays=el.checked?[...new Set([...config.schedule.workDays,day])]:config.schedule.workDays.filter(x=>x!==day);saveDraftState();
  }
});
root.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.goto!==undefined){step=Number(b.dataset.goto);config.setup.currentStep=step;saveDraftState();render();return;}
  const a=b.dataset.action;if(!a)return;
  if(a==="next"){config.setup.completedSteps=[...new Set([...config.setup.completedSteps,step])];step=Math.min(8,step+1);config.setup.currentStep=step;saveDraftState();render();}
  else if(a==="back"){step=Math.max(0,step-1);config.setup.currentStep=step;saveDraftState();render();}
  else if(a==="install")install();
  else if(a==="save-exit"){
    if(installed)install();
    else{saveDraftState();screen="installed";render();}
  }
  else if(a==="resume"){screen="wizard";render();}
  else if(a==="edit-config"){step=1;screen="wizard";render();}
  else if(a==="export-config")exportConfig();
  else if(a==="remove-staff-photo"){const member=config.staff[Number(b.dataset.index)];if(member){delete member.photoDataUrl;saveMessage="Profile photo removed.";render();saveDraftState();}}
  else if(a==="choose-restore")root.querySelector("[data-initial-backup]")?.click?.();
  else if(a==="open-preview"){screen="preview";render();}
  else if(a.startsWith("add-")){addItem(a.slice(4));render();saveDraftState();}
  else if(a.startsWith("remove-")){removeItem(a.slice(7),Number(b.dataset.index));render();saveDraftState();}
});
render();
