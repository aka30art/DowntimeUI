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
  querySelector(selector){return this.fields?.[selector]||null;}
  insertAdjacentHTML(){}
}
globalThis.document={querySelector(){return null;}};
let now=new Date("2026-11-23T06:30:00.000Z");
const root=new Root();
const config={
  installed:true,installationId:"live-shift-test",
  identity:{companyName:"QA",timezone:"Europe/London"},
  site:{siteName:"Test site",areas:[],stations:[]},
  downtime:{reasons:[]},
  schedule:{
    workDays:["mon","tue","wed","thu","fri"],
    shifts:[{id:"s1",name:"Day shift",start:"06:30",end:"16:00"}],
    breaks:[{id:"b1",name:"Meal break",start:"12:00",end:"13:00"}]
  },
  staff:[],roles:[],dailyTasks:[]
};
const api=mountWorkspace(root,config,{},{
  storage:new MemoryStorage(),
  now:()=>now
});
assert.match(root.innerHTML,/Start shift now/,"Current operating date should offer a live shift start.");
function click(action){
  const button={dataset:{action}};
  root.listeners.click({target:{closest:()=>button}});
}
click("start-shift-now");
const day=Object.values(api.getState().weeks)[0].days[0];
assert.equal(day.start,"06:30");
assert.equal(day.stop,undefined);
assert.match(root.innerHTML,/06:30–06:30 \(LIVE\)/);
assert.match(root.innerHTML,/Stop shift now/);
now=new Date("2026-11-23T09:30:00.000Z");
refreshCallback();
assert.match(root.innerHTML,/03h 00m/,"Live shift metrics should update from the recorded start time.");
now=new Date("2026-11-23T13:00:00.000Z");
refreshCallback();
assert.match(root.innerHTML,/05h 30m/,"Break deduction should apply when a live shift crosses the configured break.");
click("stop-shift-now");
assert.equal(day.stop,"13:00");
assert.match(root.innerHTML,/06:30–13:00 \(actual\)/);
assert.match(root.innerHTML,/Use configured schedule/);
click("clear-shift-times");
assert.equal(day.start,undefined);
assert.equal(day.stop,undefined);
assert.match(root.innerHTML,/06:30–16:00/);
api.selectDate("2026-11-22");
assert.doesNotMatch(root.innerHTML,/Start shift now/,"Starting a live shift is only available on the current local date.");
api.dispose();
assert.equal(clearedTimer,"live-shift-refresh","Leaving the workspace must clear the live shift refresh interval.");
globalThis.setInterval=originalSetInterval;
globalThis.clearInterval=originalClearInterval;
console.log("Live shift start/stop, automatic refresh, break overlap, schedule reset and timer cleanup: PASS");
