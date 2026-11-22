import assert from "node:assert/strict";
import {mountWorkspace} from "../src/workspace.js";
import {TENANT_STORAGE_KEY} from "../src/config-core.js";
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
const api=mountWorkspace(root,config,{}, {storage});
assert.match(root.innerHTML,/QA Company/);
assert.match(root.innerHTML,/Daily operations/);
assert.match(root.innerHTML,/06:30/);
assert.equal(api.getView(),"daily");
const monday=Object.values(api.getState().weeks)[0].days[0].date;
api.selectDate(monday);
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
assert.ok(storage.data.size>0);
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
assert.equal(api.getView(),"reports");
click("edit-config");
console.log("Local operations, downtime entry, task lock, weekly report and workspace actions: PASS");
