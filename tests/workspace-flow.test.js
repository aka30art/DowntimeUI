import assert from "node:assert/strict";
import {mountWorkspace} from "../src/workspace.js";
import {createWorkspaceBackup} from "../src/domain/backup.js";
import {TENANT_STORAGE_KEY} from "../src/config-core.js";
class Storage{
 data=new Map();failNext=false;getItem(k){return this.data.has(k)?this.data.get(k):null;}setItem(k,v){if(this.failNext){this.failNext=false;throw new Error("simulated storage quota error");}this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}
}
class Root{
 listeners={};innerHTML="";classList={add(){}};
 addEventListener(type,fn){this.listeners[type]=fn;}
 querySelector(selector){return this.fields?.[selector]||null;}
 insertAdjacentHTML(){}
}
globalThis.document={querySelector(){return null;}};
const storage=new Storage(),root=new Root();root.fields={};
let clockNow=new Date();clockNow.setHours(7,0,0,0);
const config={schemaVersion:3,installed:true,installedAt:"2026-11-22T05:00:00.000Z",installationId:"test-install",identity:{companyName:"QA Company",logoUrl:"",locale:"en-GB",timezone:"Europe/London"},site:{siteName:"Test Site",hierarchy:["Area","Station"],areas:[{id:"a1",name:"Production"}],stations:[{id:"s1",name:"Line 1",areaId:"a1"}]},downtime:{reasons:[{id:"r1",name:"Mechanical"}],presets:[{id:"preset1",name:"Mechanical Line 1",areaId:"a1",stationId:"s1",reasonId:"r1",defaultDurationMinutes:25}]},schedule:{workDays:["mon","tue","wed","thu","fri"],shifts:[{id:"sh1",name:"Day",start:"06:30",end:"16:00"}],breaks:[{id:"b1",name:"Break",start:"12:00",end:"13:00"}]},staff:[{id:"p1",name:"Operator A"}],roles:[],dailyTasks:[{id:"t1",name:"Safety check"},{id:"t2",name:"Equipment check"}],setup:{currentStep:8,completedSteps:[0,1,2,3,4,5,6,7,8],updatedAt:"2026-11-22T05:00:00.000Z"}};
let requestedSettingsStep=null;
const api=mountWorkspace(root,config,{
 onEditConfiguration:step=>{requestedSettingsStep=step;},
 onRestoreConfiguration:restored=>{
   for(const key of Object.keys(config))delete config[key];
   Object.assign(config,JSON.parse(JSON.stringify(restored)));
   return {ok:true};
 }
}, {storage,now:()=>clockNow});
assert.match(root.innerHTML,/QA Company/);
assert.match(root.innerHTML,/DAILY OPERATIONS/);
assert.equal(api.getView(),"daily");
const monday=Object.values(api.getState().weeks)[0].days[0].date;
function click(action,extra={}){
 const button={dataset:{action,...extra}};
 root.listeners.click({target:{closest:()=>button}});
}
api.selectDate(monday);
assert.match(root.innerHTML,/06:30/);
assert.match(root.innerHTML,/08h 30m/,"Configured shift and break schedule must drive the initial net availability.");
root.fields={
  "[data-shift-start]":{value:"07:00"},
  "[data-shift-stop]":{value:"16:00"}
};
click("save-shift-times");
assert.match(root.innerHTML,/08h 00m/,"Actual shift times must override the configured shift while retaining overlapping break deduction.");
assert.match(root.innerHTML,/07:00–16:00 \(actual\)/);
click("clear-shift-times");
assert.match(root.innerHTML,/08h 30m/,"Clearing actual times must restore the configured schedule.");
assert.doesNotMatch(root.innerHTML,/\(actual\)/);
const todayDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(clockNow);
api.selectDate(todayDate);
const expectedStart=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(clockNow);
click("start-shift-now");
assert.equal(Object.values(api.getState().weeks).flatMap(x=>x.days).find(x=>x.date===todayDate).start,expectedStart,"Start shift now must store the current configured-zone time.");
clockNow=new Date(clockNow.getTime()+120*60*1000);
const expectedStop=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(clockNow);
click("stop-shift-now");
const liveDay=Object.values(api.getState().weeks).flatMap(x=>x.days).find(x=>x.date===todayDate);
assert.equal(liveDay.stop,expectedStop,"Stop shift now must store the current configured-zone time.");
assert.equal(liveDay.start,expectedStart);
api.selectDate(monday);

root.fields={
 "[data-entry-preset]":{value:"preset1"},
 '[name="entry-area"]':{value:""},
 '[name="entry-station"]':{value:""},
 '[name="entry-reason"]':{value:""},
 '[name="entry-hours"]':{value:"0"},
 '[name="entry-minutes"]':{value:"0"}
};
click("apply-entry-preset");
assert.equal(root.fields['[name="entry-area"]'].value,"Production");
assert.equal(root.fields['[name="entry-station"]'].value,"s1");
assert.equal(root.fields['[name="entry-reason"]'].value,"Mechanical");
assert.equal(root.fields['[name="entry-minutes"]'].value,"25");
click("save-entry");
const days=Object.values(api.getState().weeks)[0].days;
assert.equal(days[0].entries.length,1);
assert.equal(days[0].entries[0].minutes,25);
assert.equal(days[0].operatorId,"");
const originalId=days[0].entries[0].id;
click("edit-entry",{entryId:originalId});
root.fields['[name="entry-area"]'].value="Production";
root.fields['[name="entry-station"]'].value="s1";
root.fields['[name="entry-reason"]'].value="Mechanical repair";
root.fields['[name="entry-hours"]'].value="0";
root.fields['[name="entry-minutes"]'].value="40";
assert.match(root.innerHTML,/Save changes/);
click("save-entry");
assert.equal(days[0].entries.length,1);
assert.equal(days[0].entries[0].id,originalId,"editing must preserve the original downtime entry ID");
assert.equal(days[0].entries[0].reason,"Mechanical repair");
assert.equal(days[0].entries[0].minutes,40);
assert.ok(days[0].entries[0].updatedAt);
assert.ok(storage.data.size>0);
api.setView("plant");
assert.match(root.innerHTML,/Plant overview/);
const stationStatus={dataset:{stationStatus:"s1"},value:"down",matches:selector=>selector==="[data-station-status]"};
root.listeners.change({target:stationStatus});
assert.equal(api.getState().plant.stationStates.s1,"down");
assert.match(root.innerHTML,/1 station down/);
const stationOperator={dataset:{stationOperator:"s1"},value:"p1",matches:selector=>selector==="[data-station-operator]"};
root.listeners.change({target:stationOperator});
assert.equal(api.getState().plant.assignments.s1,"p1");
click("toggle-plant");
assert.equal(api.getState().plant.status,"stopped");
assert.match(root.innerHTML,/Site stopped/);
api.setView("daily");
const taskControl={dataset:{task:"t1"},checked:true,matches:selector=>selector==="[data-task]"};
storage.failNext=true;
root.listeners.change({target:taskControl});
assert.deepEqual(api.getState().weeks[Object.keys(api.getState().weeks)[0]].days[0].dailyTasks.completedTaskIds,[],"A failed task write must roll back the in-memory completion.");
root.listeners.change({target:taskControl});
assert.deepEqual(api.getState().weeks[Object.keys(api.getState().weeks)[0]].days[0].dailyTasks.completedTaskIds,["t1"]);
click("lock-tasks");
const locked=api.getState().weeks[Object.keys(api.getState().weeks)[0]].days[0].dailyTasks;
assert.ok(locked.lockedAt);
assert.equal(locked.snapshot.length,2);
const blocked={dataset:{task:"t2"},checked:true,matches:selector=>selector==="[data-task]"};
root.listeners.change({target:blocked});
assert.deepEqual(api.getState().weeks[Object.keys(api.getState().weeks)[0]].days[0].dailyTasks.completedTaskIds,["t1"]);
click("generate-report");
assert.equal(api.getState().reports.length,1);
assert.equal(api.getState().reports[0].totals.downtimeMinutes,40,"report snapshot must include the edited entry");
assert.equal(api.getView(),"reports");
click("delete-entry",{entryId:originalId});
assert.equal(days[0].entries.length,0,"deleting an entry must remove it from the selected day");
assert.equal(api.getState().reports[0].totals.downtimeMinutes,40,"archived report snapshots must not change after later record edits");
api.setView("people");
assert.match(root.innerHTML,/WORKSPACE ADMINISTRATION/);
assert.match(root.innerHTML,/Schedule and breaks/);
click("edit-section",{step:"4"});
assert.equal(requestedSettingsStep,4,"Settings must open the requested setup section directly.");

const originalConfirm=globalThis.confirm;
globalThis.confirm=()=>true;
const backup=createWorkspaceBackup(config,api.getState());
config.identity.companyName="Local edit that should be replaced by restore";
let pickerOpened=false;
root.fields["[data-backup-file]"]={click(){pickerOpened=true;},value:""};
click("import-backup");
assert.equal(pickerOpened,true,"Import must open the JSON file picker.");
const invalidFile={text:async()=>JSON.stringify({...backup,configuration:{...backup.configuration,installationId:"another-install"}})};
await root.listeners.change({target:{matches:selector=>selector==="[data-backup-file]",files:[invalidFile],value:"invalid.json"}});
assert.match(root.innerHTML,/Backup rejected/,"Cross-installation backup must be rejected.");
assert.equal(api.getState().reports.length,1,"Rejected backup must not mutate current records.");
const validFile={text:async()=>JSON.stringify(backup)};
await root.listeners.change({target:{matches:selector=>selector==="[data-backup-file]",files:[validFile],value:"valid.json"}});
assert.match(root.innerHTML,/Workspace backup restored successfully/);
assert.equal(JSON.parse(storage.getItem(TENANT_STORAGE_KEY)).identity.companyName,"QA Company");
assert.equal(config.identity.companyName,"QA Company","Installer configuration must be refreshed from the restored backup.");
assert.equal(api.getState().reports.length,1);
assert.equal(api.getView(),"daily","Restore returns to the daily workspace.");
globalThis.confirm=originalConfirm;

console.log("Local operations, downtime CRUD, immutable task lock, reports, settings and validated backup restore: PASS");
