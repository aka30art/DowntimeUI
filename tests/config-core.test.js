import assert from "node:assert/strict";
import {
  CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, DRAFT_STORAGE_KEY, TENANT_STORAGE_KEY,
  activateInstall, cloneDefaultConfig, createId, createTenantConfig,
  loadDraft, loadInstalledConfig, saveDraft, saveInstalledConfig,
  upgradeConfig, validateConfig
} from "../src/config-core.js";
class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key,value) { this.data.set(key,String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const empty=cloneDefaultConfig();
assert.equal(empty.installed,false);
assert.equal(empty.identity.companyName,"");
assert.equal(empty.site.siteName,"");
assert.deepEqual(empty.site.areas,[]);
assert.deepEqual(empty.site.stations,[]);
assert.deepEqual(empty.downtime.reasons,[]);
assert.deepEqual(empty.schedule.workDays,[]);
assert.deepEqual(empty.schedule.shifts,[]);
assert.deepEqual(empty.staff,[]);
assert.deepEqual(empty.roles,[]);
assert.deepEqual(empty.dailyTasks,[]);
assert.ok(validateConfig(empty).includes("Company name is required."));
const c=createTenantConfig({companyName:"Example Operations",siteName:"North Site",timezone:"Europe/London"});
assert.equal(c.schemaVersion,CONFIG_SCHEMA_VERSION);
assert.deepEqual(validateConfig(c),[]);
const area={id:createId("area"),name:"Production"};
c.site.areas.push(area);
c.site.stations.push({id:createId("station"),name:"Line 1",areaId:area.id});
c.downtime.reasons.push({id:createId("reason"),name:"Mechanical"});
c.schedule.workDays=["mon","tue","wed","thu","fri"];
c.schedule.shifts.push({id:createId("shift"),name:"Day shift",start:"06:30",end:"17:00"});
c.schedule.breaks.push({id:createId("break"),name:"Morning break",start:"09:30",end:"09:45"});
c.staff.push({id:createId("staff"),name:"Alex"});
c.staff[0].photoDataUrl="data:image/jpeg;base64,AA==";
assert.deepEqual(validateConfig(c),[],"A compressed JPEG data URL is a valid optional staff profile photo.");
assert.ok(validateConfig({...c,staff:[{...c.staff[0],photoDataUrl:"data:image/svg+xml,<svg/>"}]}).some(x=>x.includes("compressed JPEG")));
c.roles.push({id:createId("role"),name:"Supervisor",permissions:{view:true,recordDowntime:true,editRecords:false,manageSettings:false,manageUsers:false,exportReports:true}});
c.staff[0].roleId=c.roles[0].id;
assert.deepEqual(validateConfig(c),[],"Staff can be linked to a configured intended access role.");
assert.ok(validateConfig({...c,staff:[{...c.staff[0],roleId:"missing-role"}]}).some(x=>x.includes("access role that does not exist")));
c.dailyTasks.push({id:createId("task"),name:"Safety inspection"});
assert.deepEqual(validateConfig(c),[]);
const active=activateInstall(c,new Date("2026-11-22T05:00:00.000Z"));
assert.equal(active.ok,true);
assert.equal(active.config.installed,true);
assert.equal(active.config.installedAt,"2026-11-22T05:00:00.000Z");
const repeat=activateInstall(active.config,new Date("2026-11-23T05:00:00.000Z"));
assert.equal(repeat.ok,true);
assert.equal(repeat.alreadyInstalled,true);
assert.equal(repeat.config.installedAt,active.config.installedAt);
const store=new MemoryStorage();
assert.equal(saveDraft(c,store).ok,true);
assert.equal(loadDraft(store).value.identity.companyName,"Example Operations");
assert.equal(saveInstalledConfig(active.config,store).ok,true);
assert.equal(store.getItem(DRAFT_STORAGE_KEY),null);
assert.equal(JSON.parse(store.getItem(TENANT_STORAGE_KEY)).installed,true);
assert.equal(loadInstalledConfig(store).value.site.siteName,"North Site");
const legacy=upgradeConfig({schemaVersion:1,identity:{companyName:"Legacy",timezone:"Europe/London"},site:{siteName:"Legacy Site"}});
assert.equal(legacy.schemaVersion,CONFIG_SCHEMA_VERSION);
assert.equal(legacy.identity.locale,"en-GB");
assert.deepEqual(legacy.site.areas,[]);
const invalid=validateConfig({...c,identity:{...c.identity,timezone:"Not/A_Zone"}});
assert.ok(invalid.some(x=>x.includes("valid IANA time zone")));
assert.ok(validateConfig({...c,site:{...c.site,stations:[{id:"s1",name:"Orphan",areaId:"missing"}]}}).some(x=>x.includes("area that does not exist")));
assert.deepEqual(validateConfig({...c,schedule:{...c.schedule,shifts:[{id:"s1",name:"Night",start:"22:00",end:"06:00"}]}}),[],"overnight shift windows are valid");
assert.ok(validateConfig({...c,schedule:{...c.schedule,shifts:[{id:"s1",name:"Invalid",start:"08:00",end:"08:00"}]}}).some(x=>x.includes("cannot be identical")));
assert.ok(validateConfig({...c,site:{...c.site,areas:[{id:"a1",name:"Production"},{id:"a2",name:"production"}]}}).some(x=>x.includes("unique")));
assert.equal(loadInstalledConfig(new MemoryStorage()).value,null);
assert.equal(saveInstalledConfig({...c,installed:false},store).ok,false);
const withPhoto=structuredClone(c);
withPhoto.staff[0].photoDataUrl="data:image/jpeg;base64,AA==";
assert.deepEqual(validateConfig(withPhoto),[],"compressed JPEG profile photos should be accepted");
const invalidPhoto=structuredClone(c);
invalidPhoto.staff[0].photoDataUrl="data:image/png;base64,AA==";
assert.ok(validateConfig(invalidPhoto).some(x=>x.includes("compressed JPEG")),"profile photos must be normalised to JPEG");
const oversizedPhoto=structuredClone(c);
oversizedPhoto.staff[0].photoDataUrl="data:image/jpeg;base64,"+"A".repeat(180001);
assert.ok(validateConfig(oversizedPhoto).some(x=>x.includes("compressed JPEG")),"oversized profile photos must be rejected");
console.log("Universal configuration, validation, migration and persistence: PASS");
