import assert from "node:assert/strict";
import {createWorkspaceBackup,restoreWorkspaceBackup,validateWorkspaceBackup} from "../src/domain/backup.js";
import {DRAFT_STORAGE_KEY,TENANT_STORAGE_KEY} from "../src/config-core.js";
const configuration={
 schemaVersion:2,installed:true,installedAt:"2026-11-22T05:00:00.000Z",installationId:"install-1",
 identity:{companyName:"Example",logoUrl:"",locale:"en-GB",timezone:"Europe/London"},
 site:{siteName:"North",hierarchy:["Area","Station"],areas:[{id:"a1",name:"Production"}],stations:[{id:"s1",name:"Line 1",areaId:"a1"}]},
 downtime:{reasons:[{id:"r1",name:"Mechanical"}]},
 schedule:{workDays:["mon"],shifts:[{id:"sh1",name:"Day",start:"06:00",end:"15:00"}],breaks:[]},
 staff:[{id:"p1",name:"Operator One"}],
 roles:[{id:"role1",name:"Supervisor",permissions:{view:true}}],
 dailyTasks:[{id:"t1",name:"Safety check"}],
 setup:{currentStep:8,completedSteps:[0,1,2,3,4,5,6,7,8],updatedAt:"2026-11-22T05:00:00.000Z"}
};
const day={date:"2026-11-23",start:"",stop:"",operatorId:"p1",
 entries:[{id:"e1",area:"Production",stationId:"s1",reason:"Mechanical",hours:0,minutes:20}],
 dailyTasks:{snapshot:[{id:"t1",name:"Safety check"}],completedTaskIds:["t1"],lockedAt:"2026-11-23T15:00:00Z",lockedBy:null}};
const operations={schemaVersion:1,installationId:"install-1",weeks:{"2026-11-23":{days:[day]}},
 reports:[{id:"rpt1",weekStart:"2026-11-23",totals:{downtimeMinutes:20}}],
 plant:{status:"running",stationStates:{s1:"running"},assignments:{s1:"p1"},history:[{id:"h1",at:"2026-11-22T05:00:00Z",label:"Line 1 assigned"}]},updatedAt:"2026-11-23T15:00:00Z"};
const valid=validateWorkspaceBackup({configuration,operations,exportedAt:"2026-11-23T15:00:00Z"},"install-1");
assert.equal(valid.ok,true,valid.errors.join("; "));
assert.equal(validateWorkspaceBackup({configuration,operations},"other-install").ok,false);
assert.ok(validateWorkspaceBackup({configuration:{...configuration,identity:{...configuration.identity,timezone:"Invalid/Zone"}},operations},"install-1").errors.some(x=>x.includes("valid IANA time zone")));
const badEntry={...operations,weeks:{"2026-11-23":{days:[{...day,entries:[{id:"e1",area:"",reason:"",minutes:0}]}]}}};
assert.ok(validateWorkspaceBackup({configuration,operations:badEntry},"install-1").errors.some(x=>x.includes("Downtime duration")));
const badStation={...operations,plant:{...operations.plant,assignments:{missing:"p1"}}};
assert.ok(validateWorkspaceBackup({configuration,operations:badStation},"install-1").errors.some(x=>x.includes("unknown station")));
const badTask={...operations,weeks:{"2026-11-23":{days:[{...day,dailyTasks:{...day.dailyTasks,completedTaskIds:["missing"]}}]}}};
assert.ok(validateWorkspaceBackup({configuration,operations:badTask},"install-1").errors.some(x=>x.includes("completion refers")));

const backup=createWorkspaceBackup(configuration,operations,{exportedAt:"2026-11-23T15:00:00Z"});
assert.equal(backup.format,"downtimeui-workspace-backup");
assert.equal(backup.backupVersion,1);
class MemoryStorage{
  values=new Map();
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}
const storage=new MemoryStorage();
storage.setItem(TENANT_STORAGE_KEY,JSON.stringify({installed:true,installationId:"install-1",identity:{companyName:"Before"}}));
storage.setItem("downtimeui:operations:v1:install-1",JSON.stringify({schemaVersion:1,installationId:"install-1",weeks:{},reports:[],plant:{status:"running",stationStates:{},assignments:{},history:[]}}));
storage.setItem(DRAFT_STORAGE_KEY,"old draft");
const restored=restoreWorkspaceBackup(backup,"install-1",{storage});
assert.equal(restored.ok,true,restored.errors.join("; "));
assert.equal(JSON.parse(storage.getItem(TENANT_STORAGE_KEY)).identity.companyName,"Example");
assert.equal(JSON.parse(storage.getItem("downtimeui:operations:v1:install-1")).weeks["2026-11-23"].days[0].entries[0].minutes,20);
assert.equal(storage.getItem(DRAFT_STORAGE_KEY),null);
const before=storage.getItem(TENANT_STORAGE_KEY);
const wrongTenant=restoreWorkspaceBackup(backup,"another-install",{storage});
assert.equal(wrongTenant.ok,false);
assert.equal(storage.getItem(TENANT_STORAGE_KEY),before,"Cross-installation restore must not overwrite the current tenant.");
class FailingStorage extends MemoryStorage{
  failKey="downtimeui:operations:v1:install-1";
  didFail=false;
  setItem(key,value){
    if(key===this.failKey&&!this.didFail){this.didFail=true;throw new Error("simulated quota error");}
    super.setItem(key,value);
  }
}
const failing=new FailingStorage();
failing.failKey=null;
failing.setItem(TENANT_STORAGE_KEY,JSON.stringify({installed:true,installationId:"install-1",identity:{companyName:"Original"}}));
failing.setItem("downtimeui:operations:v1:install-1",JSON.stringify({original:true}));
failing.failKey="downtimeui:operations:v1:install-1";
const originalConfig=failing.getItem(TENANT_STORAGE_KEY),originalOps=failing.getItem("downtimeui:operations:v1:install-1");
const failedRestore=restoreWorkspaceBackup(backup,"install-1",{storage:failing});
assert.equal(failedRestore.ok,false);
assert.equal(failing.getItem(TENANT_STORAGE_KEY),originalConfig,"Failed restore must roll configuration back.");
assert.equal(failing.getItem("downtimeui:operations:v1:install-1"),originalOps,"Failed restore must retain previous operations.");

console.log("Tenant-scoped backup validation, restore, rollback and recovery integrity: PASS");
