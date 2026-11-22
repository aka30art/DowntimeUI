import assert from "node:assert/strict";
import {validateWorkspaceBackup} from "../src/domain/backup.js";
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
console.log("Tenant-scoped backup validation and recovery integrity: PASS");
