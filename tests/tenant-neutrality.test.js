import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const paths=[
  "index.html","src/config-core.js","src/installer.js","src/workspace.js",
  "src/workspace.css","src/installer.css","src/domain/schedule.js",
  "src/domain/downtime.js","src/domain/daily-tasks.js","src/domain/permissions.js",
  "src/domain/reports.js"
];
const content=(await Promise.all(paths.map(p=>readFile(new URL("../"+p,import.meta.url),"utf8")))).join("\n");
for(const name of ["Jan","Mick","Gigi","Daz","Shayne","L&C Skip Hire","Feeder","Picking line","Magnet 1","Mick/360"]){
  assert.ok(!content.includes(name),"Tenant-specific default leaked into application source: "+name);
}
assert.doesNotMatch(content,/supabase\.co|sb_publishable_|service_role|SUPABASE_SERVICE_ROLE_KEY/i,
  "The local workspace must not include a connected Supabase project or production credential.");
assert.match(content,/No company, operator, plant, station or downtime data has been pre-filled/);
assert.match(content,/LOCAL MODE · SINGLE DEVICE/);
const core=await readFile(new URL("../src/config-core.js",import.meta.url),"utf8");
assert.match(core,/companyName: ""/);
assert.match(core,/areas: \[\], stations: \[\]/);
assert.match(core,/reasons: \[\]/);
assert.match(core,/workDays: \[\], shifts: \[\], breaks: \[\]/);
assert.match(core,/staff: \[\]/);
console.log("Tenant-neutral defaults and no-production-connection boundary: PASS");
