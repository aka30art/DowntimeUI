import assert from "node:assert/strict";
import {mountWorkspace} from "../src/workspace.js";
class Storage{
 data=new Map();getItem(k){return this.data.has(k)?this.data.get(k):null;}setItem(k,v){this.data.set(k,String(v));}
}
class Root{
 listeners={};innerHTML="";classList={add(){}};
 addEventListener(type,fn){this.listeners[type]=fn;}
 querySelector(selector){return this.fields?.[selector]||null;}
 insertAdjacentHTML(){}
}
globalThis.document={querySelector(){return null;}};
const storage=new Storage(),root=new Root();
const config={installed:true,installationId:"test-install",identity:{companyName:"QA Company",timezone:"Europe/London"},site:{siteName:"Test Site",areas:[{id:"a1",name:"Production"}],stations:[{id:"s1",name:"Line 1"}]},downtime:{reasons:[{id:"r1",name:"Mechanical"}]},schedule:{workDays:["mon","tue","wed","thu","fri"],shifts:[{id:"sh1",name:"Day",start:"06:30",end:"16:00"}],breaks:[{id:"b1",name:"Break",start:"12:00",end:"13:00"}]},staff:[{id:"p1",name:"Operator A"}],dailyTasks:[{id:"t1",name:"Safety check"},{id:"t2",name:"Equipment check"}]};
let requestedSettingsStep=null;
const api=mountWorkspace(root,config,{onEditConfiguration:step=>{requestedSettingsStep=step;}}, {storage});
assert.match(root.innerHTML,/QA Company/);
assert.match(root.innerHTML,/DAILY OPERATIONS/);
assert.equal(api.getView(),"daily");
const monday=Object.values(api.getState().weeks)[0].days[0].date;
api.selectDate(monday);
assert.match(root.innerHTML,/06:30/);
function click(action,extra={}){
 const button={dataset:{action,...extra}};
 root.listeners.click({target:{closest:()=>button}});
}
root.fields={
 '[name="entry-area"]':{value:"Production"},
 '[name="entry-station"]':{value:"s1"},
 '[name="entry-reason"]':{value:"Mechanical"},
 '[name="entry-hours"]':{value:"0"},
 '[name="entry-minutes"]':{value:"25"}
};
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
console.log("Local operations, downtime CRUD, task lock, report snapshots and direct Settings navigation: PASS");
