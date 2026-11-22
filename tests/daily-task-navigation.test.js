import assert from "node:assert/strict";
import {mountWorkspace} from "../src/workspace.js";
class MemoryStorage{
  data=new Map();
  getItem(key){return this.data.has(key)?this.data.get(key):null;}
  setItem(key,value){this.data.set(key,String(value));}
  removeItem(key){this.data.delete(key);}
}
class Root{
  listeners={};innerHTML="";classList={add(){}};
  addEventListener(type,fn){this.listeners[type]=fn;}
  querySelector(){return null;}
  insertAdjacentHTML(){}
}
globalThis.document={querySelector(){return null;}};
let now=new Date("2026-11-23T08:00:00.000Z");
const root=new Root(),storage=new MemoryStorage();
const config={
  installed:true,installationId:"task-calendar-test",
  identity:{companyName:"QA",timezone:"Europe/London"},
  site:{siteName:"QA Site",areas:[],stations:[]},
  downtime:{reasons:[]},
  schedule:{workDays:["mon","tue","wed","thu","fri"],shifts:[],breaks:[]},
  staff:[],roles:[],
  dailyTasks:[{id:"t1",name:"Safety inspection"},{id:"t2",name:"Equipment check"}]
};
const api=mountWorkspace(root,config,{}, {storage,now:()=>now});
api.selectDate("2026-11-23");
api.setView("tasks");
function click(action){
  const button={dataset:{action}};
  root.listeners.click({target:{closest:()=>button}});
}
function changeTask(id,checked){
  root.listeners.change({target:{
    dataset:{task:id},checked,
    matches:selector=>selector==="[data-task]"
  }});
}
changeTask("t1",true);
click("lock-tasks");
const monday=api.getState().weeks["2026-11-23"].days[0];
assert.ok(monday.dailyTasks.lockedAt);
assert.deepEqual(monday.dailyTasks.completedTaskIds,["t1"]);
assert.match(root.innerHTML,/Saved and locked/);

api.selectDate("2026-11-24");
assert.match(root.innerHTML,/TUE/);
assert.doesNotMatch(root.innerHTML,/Saved and locked/);
changeTask("t2",true);
click("lock-tasks");
const tuesday=api.getState().weeks["2026-11-23"].days[1];
assert.ok(tuesday.dailyTasks.lockedAt);
assert.deepEqual(tuesday.dailyTasks.completedTaskIds,["t2"]);
assert.notEqual(monday.dailyTasks.lockedAt,tuesday.dailyTasks.lockedAt);
assert.deepEqual(monday.dailyTasks.completedTaskIds,["t1"],"Locking Tuesday must not overwrite Monday's task state.");
assert.deepEqual(tuesday.dailyTasks.completedTaskIds,["t2"],"Each date must retain its own completion state.");

click("next-week");
assert.equal(api.getSelectedDate(),"2026-11-30");
assert.match(root.innerHTML,/30 Nov/);
assert.match(root.innerHTML,/No daily task templates|Task checklist/);
click("previous-week");
assert.equal(api.getSelectedDate(),"2026-11-23");
api.selectDate("2026-11-23");
assert.match(root.innerHTML,/Saved and locked/);
assert.equal(root.querySelector?.(".unused"),undefined);
const saved=JSON.parse(storage.getItem("downtimeui:operations:v1:task-calendar-test"));
assert.deepEqual(saved.weeks["2026-11-23"].days[0].dailyTasks.completedTaskIds,["t1"]);
assert.deepEqual(saved.weeks["2026-11-23"].days[1].dailyTasks.completedTaskIds,["t2"]);
console.log("Daily Tasks date/week navigation and independent per-day lock snapshots: PASS");
