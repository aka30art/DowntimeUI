import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { activatePendingUserStaffProvisioning, buildIdentityMigrationPreview, buildPendingUserStaffProvisioning, renameLinkedStaffDisplayName } from "../_shared/user-staff-identity.mjs";
import { canYardRolePerform, resolveYardRolePermissions, resolveYardRoleModulePermissions } from "../_shared/yard-role-resolver.mjs";
import { resolveRootsAuthority } from "../_shared/roots-authority.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const allowedOrigin="https://aka30art.github.io";
const headers={"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-downtime-session","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store","Vary":"Origin","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const tiers=["OWNER","DEVACC","ADMIN","MANAGER","SUPERVISOR","USER","SPECTATOR"];
const tierDefault:Record<string,Record<string,boolean>>={
 OWNER:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canControlPlantPower:true,canManageAccessRights:true,canManageUsers:true,canManageStaff:true,canManageAssignments:true,canManageSettings:true,canViewUsers:true,canViewAreaPresets:true,canManageAreaPresets:true,canViewReasonPresets:true,canManageReasonPresets:true,canViewShiftSchedule:true,canManageShiftSchedule:true,canViewDailyTasks:true,canManageDailyTasks:true,canAddDowntimeReasons:true,canDeleteRecords:true,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 DEVACC:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canControlPlantPower:true,canManageAccessRights:true,canManageUsers:true,canManageStaff:true,canManageAssignments:true,canManageSettings:true,canViewUsers:true,canViewAreaPresets:true,canManageAreaPresets:true,canViewReasonPresets:true,canManageReasonPresets:true,canViewShiftSchedule:true,canManageShiftSchedule:true,canViewDailyTasks:true,canManageDailyTasks:true,canAddDowntimeReasons:true,canDeleteRecords:true,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 ADMIN:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canControlPlantPower:true,canManageUsers:true,canManageStaff:true,canManageAssignments:true,canManageSettings:true,canManageAccessRights:true,canViewUsers:true,canViewAreaPresets:true,canManageAreaPresets:true,canViewReasonPresets:true,canManageReasonPresets:true,canViewShiftSchedule:true,canManageShiftSchedule:true,canViewDailyTasks:true,canManageDailyTasks:true,canAddDowntimeReasons:true,canDeleteRecords:false,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 MANAGER:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canControlPlantPower:true,canManageUsers:false,canManageStaff:false,canManageAssignments:false,canManageSettings:false,canManageAccessRights:false,canViewUsers:false,canViewAreaPresets:false,canManageAreaPresets:false,canViewReasonPresets:false,canManageReasonPresets:false,canViewShiftSchedule:false,canManageShiftSchedule:false,canViewDailyTasks:false,canManageDailyTasks:false,canAddDowntimeReasons:false,canDeleteRecords:false,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 SUPERVISOR:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canControlPlantPower:true,canManageUsers:false,canManageStaff:true,canManageAssignments:true,canManageSettings:false,canManageAccessRights:false,canViewUsers:false,canViewAreaPresets:false,canManageAreaPresets:false,canViewReasonPresets:true,canManageReasonPresets:false,canViewShiftSchedule:false,canManageShiftSchedule:false,canViewDailyTasks:false,canManageDailyTasks:false,canAddDowntimeReasons:true,canDeleteRecords:false,canExportReports:false,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 USER:{canEditTracker:false,canAccessYardHub:true,canAccessRepairMaintenance:false,canEditRepairMaintenance:false,canDeleteRepairMaintenance:false,canExportRepairMaintenanceReports:false,canControlPlantPower:true,canManageUsers:false,canManageStaff:false,canManageAssignments:false,canManageSettings:false,canManageAccessRights:false,canViewUsers:false,canViewAreaPresets:false,canManageAreaPresets:false,canViewReasonPresets:false,canManageReasonPresets:false,canViewShiftSchedule:false,canManageShiftSchedule:false,canViewDailyTasks:false,canManageDailyTasks:false,canAddDowntimeReasons:false,canDeleteRecords:false,canExportReports:false,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 SPECTATOR:{canEditTracker:false,canAccessYardHub:true,canAccessRepairMaintenance:false,canEditRepairMaintenance:false,canDeleteRepairMaintenance:false,canExportRepairMaintenanceReports:false,canControlPlantPower:true,canManageUsers:false,canManageStaff:false,canManageAssignments:false,canManageSettings:false,canManageAccessRights:false,canViewUsers:false,canViewAreaPresets:false,canManageAreaPresets:false,canViewReasonPresets:false,canManageReasonPresets:false,canViewShiftSchedule:false,canManageShiftSchedule:false,canViewDailyTasks:false,canManageDailyTasks:false,canAddDowntimeReasons:false,canDeleteRecords:false,canExportReports:false,canViewPlantOverview:false,canViewStaff:false,canViewAssignments:false,canViewDashboards:false,canViewReports:false}
};
const cryptoHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const digest=async(s:string)=>cryptoHex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
const hmacDigest=async(secret:string,s:string)=>{
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return cryptoHex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(s))));
};
async function hashPin(pin:string,salt:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);return cryptoHex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:150000,hash:"SHA-256"},key,256)))}
async function verifyPin(pin:string,user:any){return user?.pinSalt&&user?.pinHash&&await hashPin(pin,user.pinSalt)===user.pinHash}
function safeUser(u:any){return {username:u.username,tier:u.tier,enabled:u.enabled!==false,displayName:u.displayName||u.username,userId:u.userId||null,staffId:u.staffId||null,rootsAuthority:u.rootsAuthority||null,yardRolePermissions:u.yardRolePermissions||null}}
const lockedRolePrivileges:Record<string,Record<string,boolean>>={
 OWNER:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canManageAccessRights:true,canManageUsers:true,canManageStaff:true,canManageAssignments:true,canManageSettings:true,canViewUsers:true,canViewAreaPresets:true,canManageAreaPresets:true,canViewReasonPresets:true,canManageReasonPresets:true,canViewShiftSchedule:true,canManageShiftSchedule:true,canViewDailyTasks:true,canManageDailyTasks:true,canAddDowntimeReasons:true,canDeleteRecords:true,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
 DEVACC:{canEditTracker:true,canAccessYardHub:true,canAccessRepairMaintenance:true,canEditRepairMaintenance:true,canDeleteRepairMaintenance:true,canExportRepairMaintenanceReports:true,canManageAccessRights:true,canManageUsers:true,canManageStaff:true,canManageAssignments:true,canManageSettings:true,canViewUsers:true,canViewAreaPresets:true,canManageAreaPresets:true,canViewReasonPresets:true,canManageReasonPresets:true,canViewShiftSchedule:true,canManageShiftSchedule:true,canViewDailyTasks:true,canManageDailyTasks:true,canAddDowntimeReasons:true,canDeleteRecords:true,canExportReports:true,canViewPlantOverview:true,canViewStaff:true,canViewAssignments:true,canViewDashboards:true,canViewReports:true},
};
function addStableRecordIds(weeks:any){
 const copy=structuredClone(weeks||{});
 for(const [weekKey,week] of Object.entries(copy) as [string,any][]){
  const days=Array.isArray(week?.days)?week.days:[];
  days.forEach((day:any,dayIndex:number)=>{
   if(!Array.isArray(day?.entries))return;
   day.entries=day.entries.map((entry:any,entryIndex:number)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))return entry;
    const recordId=typeof entry.recordId==="string"&&entry.recordId?entry.recordId:`legacy-${weekKey}-${dayIndex}-${entryIndex}`;
    return {...entry,recordId};
   });
  });
 }
 return copy;
}
function normalizeBank(p:any){
 const b=p||{};
 b.appData=b.appData||{};
 b.users=Array.isArray(b.users)?b.users:[];
 const storedTiers=b.tiers&&typeof b.tiers==="object"?b.tiers:{};
 b.tiers=Object.fromEntries(tiers.map(tier=>[tier,{...tierDefault[tier],...(storedTiers[tier]||{})}]));
 for(const [tier,permissions] of Object.entries(lockedRolePrivileges))Object.assign(b.tiers[tier],permissions);
 b.staff=b.staff||{roster:[],profiles:{}};
 b.statsSource=b.statsSource||{weeks:b.appData.weeks||{}};
 return b;
}
const centralConfigDays=["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
function configString(value:any,label:string,max=120){
 const result=String(value??"").trim();
 if(result.length>max)throw new Error(label+" must be "+max+" characters or fewer");
 return result;
}
function configStringList(value:any,label:string,maxItems=250,maxLength=100){
 if(!Array.isArray(value))throw new Error(label+" must be a list");
 const result:string[]=[],seen=new Set<string>();
 for(const raw of value){
  if(typeof raw!=="string")throw new Error(label+" entries must be text");
  const item=raw.trim();if(!item)continue;
  if(item.length>maxLength)throw new Error(label+" entries must be "+maxLength+" characters or fewer");
  const key=item.toLocaleLowerCase();if(seen.has(key))throw new Error(label+" contains a duplicate entry: "+item);
  seen.add(key);result.push(item);if(result.length>maxItems)throw new Error(label+" cannot contain more than "+maxItems+" entries");
 }
 return result;
}
function normalizeCentralConfig(input:any){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Configuration object required");
 if(JSON.stringify(input).length>250000)throw new Error("Configuration is too large");
 if(Number(input.schemaVersion)!==1)throw new Error("Unsupported configuration schema version");
 const rawNavigation=input.navigation&&typeof input.navigation==="object"&&!Array.isArray(input.navigation)?input.navigation:{};
 const navigationDefaults={overview:"Overview",organisation:"Organisation",structure:"Plant & Areas",libraries:"Operational Libraries",defaults:"System Defaults",history:"Version History",navigation:"Menu & Labels"};
 const navigation:Record<string,string>={};
 for(const [key,fallback] of Object.entries({...navigationDefaults,modules:"Module Registry",controls:"System Controls",information:"System Information"})){const value=configString(rawNavigation[key]??fallback,"Navigation label",40);navigation[key]=value||fallback;}
 const modules=configStringList(input.modules||[],"Module registry",100,80);
 const organization=input.organization||{},structure=input.structure||{},libraries=input.libraries||{},defaults=input.defaults||{};
 const companyName=configString(organization.companyName,"Company name",120);
 const siteCode=configString(organization.siteCode,"Site code",32);
 const timezone=configString(organization.timezone||"Europe/London","Timezone",64);
 const locale=configString(organization.locale||"en-GB","Locale",20);
 try{new Intl.DateTimeFormat("en-GB",{timeZone:timezone}).format(new Date())}catch{throw new Error("Timezone must be a valid IANA timezone")}
 const shiftSchedule=defaults.shiftSchedule&&typeof defaults.shiftSchedule==="object"&&!Array.isArray(defaults.shiftSchedule)?structuredClone(defaults.shiftSchedule):{};
 if(JSON.stringify(shiftSchedule).length>60000)throw new Error("Shift schedule is too large");
 const shiftPresets=Array.isArray(defaults.shiftPresets)?defaults.shiftPresets.slice(0,50).map((preset:any)=>{
  if(!preset||typeof preset!=="object"||Array.isArray(preset)||!preset.config||typeof preset.config!=="object"||Array.isArray(preset.config))throw new Error("Shift presets must contain a name and configuration");
  return {name:configString(preset.name,"Shift preset name",60),config:preset.config};
 }).filter((preset:any)=>preset.name):[];
 const weekStartsOn=String(defaults.weekStartsOn||"MONDAY").toUpperCase();
 if(!centralConfigDays.includes(weekStartsOn))throw new Error("Week start must be a valid day");
 const operatingDays=configStringList(defaults.operatingDays||centralConfigDays.slice(0,6),"Operating days",7,12).map((day:string)=>day.toUpperCase());
 if(operatingDays.some(day=>!centralConfigDays.includes(day)))throw new Error("Operating days contain an invalid day");
 const breakDeductionMinutes=Number(defaults.breakDeductionMinutes);
 if(!Number.isInteger(breakDeductionMinutes)||breakDeductionMinutes<0||breakDeductionMinutes>240)throw new Error("Break deduction must be between 0 and 240 minutes");
 return {
  schemaVersion:1,
  navigation,
  modules,
  organization:{companyName,siteCode,timezone,locale},
  structure:{sites:configStringList(structure.sites||[],"Sites"),plants:configStringList(structure.plants||[],"Plants"),areas:configStringList(structure.areas||[],"Plant areas"),stations:configStringList(structure.stations||[],"Stations")},
  libraries:{areaPresets:configStringList(libraries.areaPresets||[],"Area presets"),downtimeReasons:configStringList(libraries.downtimeReasons||[],"Downtime reasons"),dailyTaskPresets:configStringList(libraries.dailyTaskPresets||[],"Daily task presets",250,120),equipmentCategories:configStringList(libraries.equipmentCategories||[],"Equipment categories"),eventCategories:configStringList(libraries.eventCategories||[],"Event categories"),statusCategories:configStringList(libraries.statusCategories||[],"Status categories")},
  defaults:{shiftSchedule,shiftPresets,weekStartsOn,operatingDays,breakDeductionMinutes}
 };
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS"){if(req.headers.get("origin")&&req.headers.get("origin")!==allowedOrigin)return new Response("Forbidden",{status:403});return new Response("ok",{headers})}
 if(req.headers.get("origin")&&req.headers.get("origin")!==allowedOrigin)return json({error:"Origin denied"},403);
 if(req.method!=="POST")return json({error:"POST only"},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Server config missing"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 let body:any;try{body=await req.json()}catch{return json({error:"Bad JSON"},400)}
 const action=body?.action;
 const {data:row,error:loadErr}=await db.from("downtime_central_bank").select("payload,version,updated_at").eq("id",1).maybeSingle();
 if(loadErr)return json({error:"Central data bank unavailable"},500);
 let bank=normalizeBank(row?.payload);
 if(action==="bootstrap"){
   const {data:setupCode,error:setupCodeError}=await db.rpc("downtime_get_bootstrap_code");if(setupCodeError||typeof setupCode!=="string"||!setupCode)return json({error:"Bootstrap code is not configured in Supabase Vault"},503);if(typeof body.bootstrapCode!=="string"||body.bootstrapCode!==setupCode)return json({error:"Bootstrap code invalid"},401);
   if(bank.users.length>0)return json({error:"Bootstrap already completed"},409);
   const suppliedUsername=String(body.username||"").trim(),username="DEV",pin=String(body.pin||"");
   if(suppliedUsername.toUpperCase()!=="DEV"||!/^[0-9]{4,8}$/.test(pin))return json({error:"The root OWNER username is fixed as DEV; PIN must be 4-8 digits"},400);
   const salt=cryptoHex(crypto.getRandomValues(new Uint8Array(16)));
   bank.users=[{username,displayName:username,tier:"OWNER",enabled:true,pinSalt:salt,pinHash:await hashPin(pin,salt)}];
   const {data:bootWrite,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",row?.version||0).select("id").maybeSingle();
   if(error||!bootWrite)return json({error:"Bootstrap conflict; refresh and retry"},409);
   await db.from("downtime_central_audit").insert({username,action:"bootstrap",details:{}});
   return json({ok:true,message:"Owner account initialized. Sign in."});
 }
 if(action==="login"){
   const username=String(body.username||"").trim(),pin=String(body.pin||""),rateKey=username.toLowerCase();
   if(pin.length>8||!username||!/^[0-9]{4,8}$/.test(pin))return json({error:"Invalid credentials"},401);
   const cutoff=new Date(Date.now()-5*60*1000).toISOString();
   const {count:failedCount,error:rateError}=await db.from("downtime_central_audit").select("id",{count:"exact",head:true}).eq("username",rateKey).eq("action","login-failed").gte("created_at",cutoff);
   if(rateError)return json({error:"Login service temporarily unavailable"},503);
   if((failedCount||0)>=5)return json({error:"Too many failed attempts. Try again in five minutes."},429);
   const user=bank.users.find((u:any)=>u.username.toLowerCase()===rateKey&&u.enabled!==false);
   const pinCandidate=user?.pinSalt&&user?.pinHash?user:{pinSalt:"central-login-dummy-salt",pinHash:"0".repeat(64)};
   const validPin=await verifyPin(pin,pinCandidate);
   if(!user||!validPin){await db.from("downtime_central_audit").insert({username:rateKey,action:"login-failed",details:{}});return json({error:"Invalid username or PIN"},401);}
   const token=cryptoHex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await digest(token),expires=new Date(Date.now()+12*60*60*1000);
   const {error}=await db.from("downtime_central_sessions").insert({token_hash:tokenHash,username:user.username,expires_at:expires.toISOString()});
   if(error)return json({error:"Session creation failed"},500);
   await db.from("downtime_central_audit").insert({username:user.username,action:"login",details:{}});
   return json({token,expiresAt:expires.toISOString(),user:safeUser(user)});
 }
 if(action==="list-users"&&!req.headers.get("x-downtime-session"))return json({users:bank.users.filter((u:any)=>u.enabled!==false).map((u:any)=>({username:u.username}))});
 const token=req.headers.get("x-downtime-session")||"",tokenHash=await digest(token);
 const {data:session}=await db.from("downtime_central_sessions").select("username,expires_at").eq("token_hash",tokenHash).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(!session)return json({error:"Session expired. Sign in again."},401);
 const currentUser=bank.users.find((u:any)=>u.username===session.username&&u.enabled!==false);
 if(!currentUser)return json({error:"Account disabled"},401);
 const [{data:rootsBootstrap,error:rootsBootstrapError},{data:rootsAssignment,error:rootsAssignmentError}]=await Promise.all([
   db.from("downtime_roots_bootstrap").select("user_id").eq("singleton",true).maybeSingle(),
   currentUser.userId?db.from("downtime_roots_assignments").select("user_id,staff_id,roots_class,status").eq("user_id",currentUser.userId).maybeSingle():Promise.resolve({data:null,error:null})
 ]);
 if(rootsBootstrapError||rootsAssignmentError)return json({error:"Protected ROOTS identity registry is unavailable."},503);
 const rootsAuthority=resolveRootsAuthority(currentUser,rootsAssignment,rootsBootstrap?.user_id||null);
 const tier=currentUser.tier,storedPrivileges=bank.tiers[tier]||{},priv={...tierDefault[tier],...storedPrivileges};
 if(lockedRolePrivileges[tier])Object.assign(priv,lockedRolePrivileges[tier]);
 const currentUsername=String(currentUser.username||"").trim().toUpperCase();
 const isDevRoot=rootsAuthority==="DEV";
 const isRootAuthority=["DEV","DEV1","ADMIN"].includes(rootsAuthority||"");
 let resolvedYardRole:any=null;
 let moduleRights:any=null;
 const hasCanonicalIdentity=Boolean(currentUser.userId||currentUser.staffId);
 if(hasCanonicalIdentity&&!isRootAuthority){
   if(currentUser.enabled!==true||currentUser.status!=="ACTIVE"||!currentUser.userId||!currentUser.staffId)return json({error:"Canonical USER/STAFF identity is not active or complete."},403);
   const {data:yardAssignment,error:yardAssignmentError}=await db.from("yard_role_assignments")
     .select("user_id,staff_id,yard_role_id,status").eq("user_id",currentUser.userId).eq("status","ACTIVE").maybeSingle();
   if(yardAssignmentError)return json({error:"Canonical YARD ROLE assignment is unavailable."},503);
   if(!yardAssignment||String(yardAssignment.staff_id).toLowerCase()!==String(currentUser.staffId).toLowerCase()||
      (currentUser.yardRoleId&&String(yardAssignment.yard_role_id).toLowerCase()!==String(currentUser.yardRoleId).toLowerCase()))
     return json({error:"An active reciprocal YARD ROLE assignment is required for this department."},403);
   const [{data:yardRole,error:yardRoleError},{data:departmentRows,error:departmentRowsError}]=await Promise.all([
     db.from("yard_roles").select("id,name,description,status").eq("id",yardAssignment.yard_role_id).eq("status","ACTIVE").maybeSingle(),
     db.from("yard_role_department_permissions").select("yard_role_id,department,can_view,can_enter,can_edit,can_manage").eq("yard_role_id",yardAssignment.yard_role_id),
   ]);
   if(yardRoleError||departmentRowsError||!yardRole)return json({error:"Canonical YARD ROLE permission profile is unavailable."},503);
   try{resolvedYardRole=resolveYardRolePermissions(yardRole,departmentRows||[])}
   catch(error){return json({error:error instanceof Error?error.message:"Canonical YARD ROLE permission profile is invalid."},503)}
   moduleRights=resolveYardRoleModulePermissions(resolvedYardRole);
   const downtime=moduleRights.DOWNTIME;
   const staffManagement=moduleRights["Staff & Management"];
   const hasConnectedModuleAccess=Object.values(moduleRights).some((rights:any)=>rights.view||rights.enter||rights.edit||rights.manage);
   if(!hasConnectedModuleAccess)return json({error:"This USER has no access to a connected application module."},403);
   Object.assign(priv,{
     canEditTracker:downtime.enter||downtime.edit||downtime.manage,
     canDeleteRecords:downtime.manage,
     canExportReports:downtime.view,
     canViewPlantOverview:downtime.view,
     canViewDashboards:downtime.view,
     canViewReports:downtime.view,
     canControlPlantPower:false,
     canManageStaff:staffManagement.manage===true,
     canEnterStaff:staffManagement.enter===true,
     canEditStaff:staffManagement.edit===true,
     canViewStaff:staffManagement.view===true,
     canManageAssignments:staffManagement.manage===true,
     canViewAssignments:staffManagement.view===true,
     canManageAccessRights:false,
     canManageSettings:downtime.manage===true,
     canViewStations:staffManagement.view===true||downtime.view===true,
     canViewAreaPresets:downtime.view,canManageAreaPresets:downtime.manage===true,
     canViewReasonPresets:downtime.view,canManageReasonPresets:downtime.manage===true,
     canViewShiftSchedule:downtime.view,canManageShiftSchedule:downtime.manage===true,
     canViewDailyTasks:downtime.view,canManageDailyTasks:downtime.manage===true,
     canAddDowntimeReasons:downtime.manage===true,
   });
 }
 if(isRootAuthority){
   Object.assign(priv,{
     canEditTracker:true,canDeleteRecords:true,canExportReports:true,canViewPlantOverview:true,canViewDashboards:true,canViewReports:true,
     canControlPlantPower:true,
   });
   if(rootsAuthority!=="DEV"){
     Object.assign(priv,{canManageSettings:true,canManageAccessRights:false});
   }
   Object.assign(priv,{canManageStaff:true,canEnterStaff:true,canEditStaff:true,canViewStaff:true,canManageAssignments:true,canViewAssignments:true});
 }
 // Ordinary USER directory operations follow Staff Management MANAGE; protected control-plane governance remains immutable DEV-only.
 priv.canManageUsers=["DEV","DEV1","ADMIN"].includes(rootsAuthority||"")||(hasCanonicalIdentity&&resolvedYardRole&&moduleRights["Staff & Management"]?.manage===true);priv.canViewUsers=["DEV","DEV1","ADMIN"].includes(rootsAuthority||"")||(hasCanonicalIdentity&&resolvedYardRole&&(moduleRights["Staff & Management"]?.view===true||moduleRights["Staff & Management"]?.manage===true));
 const isCentralAdmin=isDevRoot;
 const isCentralBankAccess=isDevRoot;
 if(action==="user-staff-provision"){
   if(!priv.canManageUsers)return json({error:"Management MANAGE permission or immutable DEV authority is required to provision USER + STAFF identities."},403);
   const username=String(body.username||"").trim(),displayName=String(body.displayName||"").trim(),pin=String(body.pin||"");
   const idempotencyKey=String(body.idempotencyKey||""),requestedYardRoleId=String(body.requestedYardRoleId||"");
   const staffFields=body.staff&&typeof body.staff==="object"&&!Array.isArray(body.staff)?body.staff:{};
   if(!/^[0-9a-f-]{36}$/i.test(idempotencyKey))return json({error:"A UUID idempotency key is required."},400);
   if(!/^[0-9]{4,8}$/.test(pin))return json({error:"PIN must contain 4–8 digits."},400);
   const fingerprintSecret=Deno.env.get("DOWNTIME_IDENTITY_FINGERPRINT_SECRET")||"";
   if(fingerprintSecret.length<32)return json({error:"Identity provisioning fingerprint secret is not configured. USER remains uncreated."},503);
   const requestFingerprint=await hmacDigest(fingerprintSecret,JSON.stringify({username,displayName,pin,staff:staffFields,requestedYardRoleId}));
   try{
     const pinSalt=cryptoHex(crypto.getRandomValues(new Uint8Array(16)));
     const pending=buildPendingUserStaffProvisioning(bank,{
       userFields:{username,displayName},staffFields,idempotencyKey,requestedYardRoleId,requestFingerprint,
       userId:crypto.randomUUID(),staffId:crypto.randomUUID(),pinSalt,pinHash:await hashPin(pin,pinSalt),actorUserId:currentUser.userId,actorUsername:currentUser.username,actorDisplayName:currentUser.displayName||currentUser.username
     });
     if(pending.replayed)return json({ok:true,replayed:true,version:Number(row?.version||0),userId:pending.receipt.userId,staffId:pending.receipt.staffId,stage:pending.receipt.stage,requestedYardRoleId:pending.receipt.requestedYardRoleId});
     if(!pending.auditEvent)return json({error:"Provisioning audit event is missing."},500);
     if(!Number.isInteger(Number(body.version))||Number(body.version)!==Number(row?.version||0))return json({error:"Central USER directory changed. Refresh and retry provisioning."},409);
     const {data:commit,error:commitError}=await db.rpc("downtime_central_commit_identity_event",{
       p_expected_version:Number(body.version),
       p_payload:pending.payload,
       p_actor_username:currentUser.username,
       p_action:pending.auditEvent.action,
       p_details:pending.auditEvent
     });
     if(commitError||!commit)return json({error:commitError?.message?.includes("VERSION_CONFLICT")?"Central USER directory changed. Refresh and retry provisioning.":"USER/STAFF provisioning commit failed."},409);
     return json({ok:true,replayed:false,version:Number(commit.version),userId:pending.receipt.userId,staffId:pending.receipt.staffId,stage:pending.receipt.stage,requestedYardRoleId},201);
   }catch(error){return json({error:error instanceof Error?error.message:"Invalid USER/STAFF provisioning request."},400)}
 }
 if(action==="user-staff-activate"){
   if(!priv.canManageUsers)return json({error:"Management MANAGE permission or immutable DEV authority is required to activate USER identities."},403);
   if(Deno.env.get("DOWNTIME_CANONICAL_AUTH_READY")!=="true")return json({error:"Canonical USER sessions and YARD ROLE authorization are not yet active. The USER remains disabled."},503);
   const userId=String(body.userId||"");
   if(!/^[0-9a-f-]{36}$/i.test(userId))return json({error:"Immutable USER ID required."},400);
   const target=bank.users.find((item:any)=>String(item.userId||"").toLowerCase()===userId.toLowerCase());
   if(!target)return json({error:"Provisioned USER was not found."},404);
   const {data:assignment,error:assignmentError}=await db.from("yard_role_assignments")
     .select("user_id,staff_id,yard_role_id,status,version,verified_at")
     .eq("user_id",target.userId).eq("status","ACTIVE").maybeSingle();
   if(assignmentError||!assignment)return json({error:"A persisted active canonical YARD ROLE assignment is required; USER remains inactive."},409);
   const {data:role,error:roleError}=await db.from("yard_roles").select("id,name,description,status").eq("id",assignment.yard_role_id).eq("status","ACTIVE").maybeSingle();
   const {data:permissions,error:permissionsError}=await db.from("yard_role_department_permissions").select("yard_role_id,department,can_view,can_enter,can_edit,can_manage").eq("yard_role_id",assignment.yard_role_id);
   if(roleError||permissionsError||!role)return json({error:"Assigned canonical YARD ROLE is no longer active."},409);
   try{resolveYardRolePermissions(role,permissions||[])}catch(error){return json({error:error instanceof Error?error.message:"Assigned YARD ROLE permission matrix is no longer valid."},409)}
   const roleAssignment={userId:assignment.user_id,staffId:assignment.staff_id,yardRoleId:assignment.yard_role_id,status:assignment.status,version:Number(assignment.version),verifiedAt:assignment.verified_at};
   let activation;
   try{activation=activatePendingUserStaffProvisioning(bank,roleAssignment,{userId:currentUser.userId,username:currentUser.username,displayName:currentUser.displayName||currentUser.username})}catch(error){return json({error:error instanceof Error?error.message:"USER provisioning activation failed."},400)}
   if(activation.replayed)return json({ok:true,replayed:true,version:Number(row?.version||0),userId:activation.user.userId,username:activation.user.username,enabled:true,yardRoleId:roleAssignment.yardRoleId});
   if(!activation.auditEvent)return json({error:"Activation audit event is missing."},500);
   if(!Number.isInteger(Number(body.version))||Number(body.version)!==Number(row?.version||0))return json({error:"Central USER directory changed. Refresh before activation."},409);
   const {data:commit,error:commitError}=await db.rpc("downtime_central_commit_identity_event",{
     p_expected_version:Number(body.version),
     p_payload:activation.payload,
     p_actor_username:currentUser.username,
     p_action:activation.auditEvent.action,
     p_details:activation.auditEvent
   });
   if(commitError||!commit)return json({error:commitError?.message?.includes("VERSION_CONFLICT")?"Central USER directory changed. Refresh before activation.":"USER activation commit failed."},409);
   return json({ok:true,replayed:false,version:Number(commit.version),userId:activation.user.userId,username:activation.user.username,enabled:true,yardRoleId:roleAssignment.yardRoleId});
 }
 if(action==="identity-reset"){
   if(!isDevRoot)return json({error:"Only the currently authenticated immutable DEV may perform the one-time identity reset."},403);
   if(String(body.confirmation||"")!=="KEEP DEV - CLEAR USERS STAFF PHOTOS")return json({error:"Type KEEP DEV - CLEAR USERS STAFF PHOTOS exactly to confirm the permanent reset."},400);
   const currentDevPin=String(body.currentDevPin||"");
   if(!/^[0-9]{4,8}$/.test(currentDevPin)||!await verifyPin(currentDevPin,currentUser))return json({error:"Current DEV PIN verification failed."},401);
   if(!row||!Number.isInteger(Number(row.version)))return json({error:"Central USER directory version is unavailable."},503);

   // Staff profile photographs live in this dedicated bucket. Operational evidence and report buckets are not touched.
   const listAllStaffPhotoPaths=async(prefix=""):Promise<string[]>=>{
     const paths:string[]=[];
     let offset=0;
     for(;;){
       const {data,error}=await db.storage.from("downtime-staff-photos").list(prefix,{limit:1000,offset});
       if(error)throw error;
       const entries=Array.isArray(data)?data:[];
       for(const entry of entries){
         const name=String(entry?.name||"");
         if(!name)continue;
         const path=prefix?prefix+"/"+name:name;
         if(entry.id==null&&entry.metadata==null)paths.push(...await listAllStaffPhotoPaths(path));
         else paths.push(path);
       }
       if(entries.length<1000)break;
       offset+=entries.length;
     }
     return paths;
   };
   let staffPhotoPaths:string[]=[];
   let staffOriginalsDeleted=0;
   try{
     const githubToken=String(Deno.env.get("GITHUB_STAFF_IMAGE_TOKEN")||"");
     const githubHeaders:Record<string,string>={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
     if(githubToken)githubHeaders.Authorization="Bearer "+githubToken;
     const githubOriginalsApi="https://api.github.com/repos/aka30art/DOWNTIME/contents/assets/staff/originals";
     const listGithubStaffOriginals=async()=>{
       const directoryResponse=await fetch(githubOriginalsApi+"?ref=main",{headers:githubHeaders});
       if(directoryResponse.status===404)return [];
       if(!directoryResponse.ok)throw new Error("GitHub STAFF originals directory lookup failed.");
       const directories=await directoryResponse.json();
       if(!Array.isArray(directories))throw new Error("GitHub STAFF originals directory response is invalid.");
       const originals:{slug:string;sha:string}[]=[];
       for(const directory of directories){
         const slug=String(directory?.name||"");
         if(directory?.type!=="dir"||!/^[a-z0-9]{1,30}$/.test(slug))continue;
         const folderResponse=await fetch(githubOriginalsApi+"/"+encodeURIComponent(slug)+"?ref=main",{headers:githubHeaders});
         if(folderResponse.status===404)continue;
         if(!folderResponse.ok)throw new Error("GitHub STAFF original lookup failed for a photo folder.");
         const folderFiles=await folderResponse.json();
         if(!Array.isArray(folderFiles))throw new Error("GitHub STAFF photo folder response is invalid.");
         const original=folderFiles.find((entry:any)=>entry?.type==="file"&&entry.name==="original.png"&&entry.sha);
         if(original)originals.push({slug,sha:String(original.sha)});
       }
       return originals;
     };
     const githubOriginals=await listGithubStaffOriginals();
     if(githubOriginals.length&&!githubToken)throw new Error("GitHub STAFF original photos exist but the deletion token is not configured.");
     staffPhotoPaths=await listAllStaffPhotoPaths();
     for(const original of githubOriginals){
       const fileApi=githubOriginalsApi+"/"+encodeURIComponent(original.slug)+"/original.png";
       const deleted=await fetch(fileApi,{method:"DELETE",headers:{...githubHeaders,"Content-Type":"application/json"},body:JSON.stringify({message:"Remove STAFF original photo during identity reset: "+original.slug,sha:original.sha,branch:"main"})});
       if(!deleted.ok)throw new Error("GitHub STAFF original photo deletion failed for a photo folder.");
       staffOriginalsDeleted++;
     }
     for(let offset=0;offset<staffPhotoPaths.length;offset+=100){
       const {error}=await db.storage.from("downtime-staff-photos").remove(staffPhotoPaths.slice(offset,offset+100));
       if(error)throw error;
     }
     const remainingStorage=await listAllStaffPhotoPaths();
     const remainingGitHub=await listGithubStaffOriginals();
     if(remainingStorage.length||remainingGitHub.length)throw new Error("STAFF photo storage or GitHub originals are not empty after deletion.");
   }catch(error){
     return json({error:error instanceof Error?error.message:"STAFF photo deletion could not be verified. Identity reset was not committed."},503);
   }

   const {data:reset,error:resetError}=await db.rpc("downtime_identity_reset_preserve_dev",{
     p_expected_version:Number(row.version),
     p_actor_user_id:currentUser.userId,
     p_actor_username:currentUser.username,
     p_actor_display_name:currentUser.displayName||currentUser.username,
     p_actor_session_hash:tokenHash
   });
   if(resetError||!reset?.ok)return json({error:resetError?.message?.includes("already been completed")?"The one-time identity reset has already been completed.":resetError?.message?.includes("VERSION_CONFLICT")?"The USER directory changed. Refresh and retry the reset.":resetError?.message||"The identity reset could not be committed. STAFF photos were removed; retry after checking the current state."},409);
   return json({...reset,staffPhotoObjectsRemoved:staffPhotoPaths.length,staffOriginalsDeleted,rootedRoleDefinitions:["DEV1","ADMIN"],devUserIdPreserved:currentUser.userId});
 }
 if(action==="identity-diagnostics"){
   if(!isDevRoot)return json({error:"Identity diagnostics are restricted to immutable DEV."},403);
   const preview=buildIdentityMigrationPreview(bank);
   const {count:resetCount,error:resetStatusError}=await db.from("downtime_identity_reset_runs").select("singleton",{count:"exact",head:true});
   return json({contractVersion:1,centralVersion:Number(row?.version||0),preview,resetCompleted:!resetStatusError&&(resetCount||0)>0,resetStatusAvailable:!resetStatusError});
 }
 if(action==="photo-evidence-context"){
   return json({user:{username:currentUser.username,displayName:currentUser.displayName||currentUser.username},permissions:{canViewDashboards:priv.canViewDashboards===true,canEditTracker:priv.canEditTracker===true,canDeleteRecords:priv.canDeleteRecords===true}});
 }
 if(action==="list-users"){
   const visibleUsers=priv.canManageUsers||priv.canViewUsers?bank.users.filter((u:any)=>u.enabled!==false).map(safeUser):[safeUser(currentUser)];
   return json({users:visibleUsers});
 }
 if(action==="central-admin-state"){
   if(!isCentralBankAccess)return json({error:"Central Data Bank access is restricted to immutable DEV."},403);
   return json({payload:{...bank,users:bank.users.map(safeUser)},version:row?.version||0,updatedAt:row?.updated_at||null,user:safeUser(currentUser)});
 }
  if(typeof action==="string"&&action.startsWith("central-config-")&&!isCentralBankAccess)return json({error:"Central configuration is restricted to immutable DEV."},403);
  if(action==="central-config-state"){
    const {data:configState,error:configError}=await db.from("downtime_central_config_state").select("*").eq("id",1).maybeSingle();
    if(configError||!configState)return json({error:"Configuration control plane is not installed. Apply the Central Data Bank configuration migration first."},503);
    const {data:history,error:historyError}=await db.from("downtime_central_config_history").select("version,parent_version,action,actor,note,created_at,published_at").order("version",{ascending:false}).limit(40);
    if(historyError)return json({error:"Configuration history unavailable"},503);
    const versions=(history||[]).map((item:any)=>({...item,status:Number(item.version)===Number(configState.published_version)?"PUBLISHED":Number(item.version)===Number(configState.draft_version)?"CURRENT DRAFT":"HISTORICAL"}));
    return json({draft:configState.draft_payload,published:configState.published_payload,draftVersion:Number(configState.draft_version),publishedVersion:Number(configState.published_version),nextVersion:Number(configState.next_version),updatedBy:configState.updated_by,updatedAt:configState.updated_at,publishedBy:configState.published_by,publishedAt:configState.published_at,versions,user:safeUser(currentUser)});
  }
  if(action==="central-config-save-draft"){
    const {data:configState,error:configError}=await db.from("downtime_central_config_state").select("*").eq("id",1).maybeSingle();
    if(configError||!configState)return json({error:"Configuration control plane is not installed"},503);
    if(Number(body.draftVersion)!==Number(configState.draft_version)||Number(body.nextVersion)!==Number(configState.next_version))return json({error:"Draft changed in another session. Refresh before saving."},409);
    let config:any;try{config=normalizeCentralConfig(body.config)}catch(error){return json({error:error instanceof Error?error.message:"Invalid configuration"},400)}
    const newVersion=Number(configState.next_version);let note="Draft configuration saved";try{note=configString(body.note||note,"Change note",240)}catch(error){return json({error:error instanceof Error?error.message:"Invalid change note"},400)}
    const {error:historyInsertError}=await db.from("downtime_central_config_history").insert({version:newVersion,payload:config,parent_version:configState.draft_version,action:"draft-save",actor:currentUser.username,note});
    if(historyInsertError)return json({error:"Unable to create configuration version"},409);
    const {data:write,error}=await db.from("downtime_central_config_state").update({draft_payload:config,draft_version:newVersion,next_version:newVersion+1,updated_by:currentUser.username,updated_at:new Date().toISOString()}).eq("id",1).eq("draft_version",Number(body.draftVersion)).eq("next_version",Number(body.nextVersion)).select("id").maybeSingle();
    if(error||!write){await db.from("downtime_central_config_history").delete().eq("version",newVersion);return json({error:"Draft changed in another session. Refresh before saving."},409)}
    await db.from("downtime_central_audit").insert({username:currentUser.username,action:"central-config-draft-save",details:{version:newVersion}});
    return json({ok:true,draftVersion:newVersion,nextVersion:newVersion+1,updatedAt:new Date().toISOString()});
  }
  if(action==="central-config-publish"){
    const {data:configState,error:configError}=await db.from("downtime_central_config_state").select("*").eq("id",1).maybeSingle();
    if(configError||!configState)return json({error:"Configuration control plane is not installed"},503);
    if(Number(body.draftVersion)!==Number(configState.draft_version)||Number(body.publishedVersion)!==Number(configState.published_version))return json({error:"Configuration changed in another session. Refresh before publishing."},409);
    if(Number(configState.draft_version)===Number(configState.published_version))return json({error:"There are no unpublished changes to activate."},409);
    try{normalizeCentralConfig(configState.draft_payload)}catch(error){return json({error:error instanceof Error?error.message:"Draft validation failed"},400)}
    const now=new Date().toISOString();
    const {data:write,error}=await db.from("downtime_central_config_state").update({published_payload:configState.draft_payload,published_version:configState.draft_version,published_by:currentUser.username,published_at:now}).eq("id",1).eq("draft_version",Number(body.draftVersion)).eq("published_version",Number(body.publishedVersion)).select("id").maybeSingle();
    if(error||!write)return json({error:"Configuration changed in another session. Refresh before publishing."},409);
    await db.from("downtime_central_config_history").update({published_at:now}).eq("version",Number(configState.draft_version));
    await db.from("downtime_central_audit").insert({username:currentUser.username,action:"central-config-publish",details:{version:Number(configState.draft_version)}});
    return json({ok:true,publishedVersion:Number(configState.draft_version),publishedAt:now});
  }
  if(action==="central-config-restore-draft"){
    const {data:configState,error:configError}=await db.from("downtime_central_config_state").select("*").eq("id",1).maybeSingle();
    if(configError||!configState)return json({error:"Configuration control plane is not installed"},503);
    if(Number(body.draftVersion)!==Number(configState.draft_version)||Number(body.nextVersion)!==Number(configState.next_version))return json({error:"Draft changed in another session. Refresh before restoring."},409);
    const sourceVersion=Number(body.sourceVersion);
    if(!Number.isSafeInteger(sourceVersion)||sourceVersion<1)return json({error:"Select a valid historical version"},400);
    const {data:source,error:sourceError}=await db.from("downtime_central_config_history").select("payload").eq("version",sourceVersion).maybeSingle();
    if(sourceError||!source)return json({error:"Historical configuration version not found"},404);
    let config:any;try{config=normalizeCentralConfig(source.payload)}catch(error){return json({error:error instanceof Error?error.message:"Historical configuration is invalid"},400)}
    const newVersion=Number(configState.next_version),note="Restored historical version v"+sourceVersion+" as a new draft";
    const {error:historyInsertError}=await db.from("downtime_central_config_history").insert({version:newVersion,payload:config,parent_version:sourceVersion,action:"restore-draft",actor:currentUser.username,note});
    if(historyInsertError)return json({error:"Unable to create restored draft"},409);
    const {data:write,error}=await db.from("downtime_central_config_state").update({draft_payload:config,draft_version:newVersion,next_version:newVersion+1,updated_by:currentUser.username,updated_at:new Date().toISOString()}).eq("id",1).eq("draft_version",Number(body.draftVersion)).eq("next_version",Number(body.nextVersion)).select("id").maybeSingle();
    if(error||!write){await db.from("downtime_central_config_history").delete().eq("version",newVersion);return json({error:"Draft changed in another session. Refresh before restoring."},409)}
    await db.from("downtime_central_audit").insert({username:currentUser.username,action:"central-config-restore-draft",details:{sourceVersion,newVersion}});
    return json({ok:true,draftVersion:newVersion,nextVersion:newVersion+1,sourceVersion});
  }
  const bumpCentralVersion=async()=>{
   const {data:current}=await db.from("downtime_central_bank").select("version").eq("id",1).maybeSingle();
   if(!current)return null;
   const next=Number(current.version||0)+1;
   const {data:updated}=await db.from("downtime_central_bank").update({version:next,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(current.version||0)).select("id").maybeSingle();
   return updated?next:null;
 };
 if(action==="daily-operator-list"){
   if(hasCanonicalIdentity&&!isRootAuthority&&!moduleRights.DOWNTIME.view)return json({error:"SCPL VIEW permission is required to read the DOWNTIME daily operator register."},403);
   const fromDate=String(body.fromDate||""),toDate=String(body.toDate||"");
   if(!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(toDate)||fromDate>toDate)return json({error:"A valid date range is required"},400);
   const rangeDays=(Date.parse(toDate+"T00:00:00Z")-Date.parse(fromDate+"T00:00:00Z"))/86400000;
   if(!Number.isFinite(rangeDays)||rangeDays>370)return json({error:"Date range cannot exceed 370 days"},400);
   const {data:records,error}=await db.from("downtime_daily_operator_assignments").select("duty_date,operator_name,is_locked,assigned_by,assigned_at,locked_by,locked_at,updated_by,updated_at").gte("duty_date",fromDate).lte("duty_date",toDate).order("duty_date",{ascending:true});
   if(error)return json({error:"Daily operator register is unavailable"},503);
   const {data:history,error:historyError}=await db.from("downtime_daily_operator_audit").select("duty_date,action,operator_name,previous_operator,actor,reason,created_at").gte("duty_date",fromDate).lte("duty_date",toDate).order("created_at",{ascending:false});
   if(historyError)return json({error:"Daily operator audit history is unavailable"},503);
   return json({records:records||[],history:history||[]});
 }
 if(action==="daily-operator-assign"){
   if(!isRootAuthority&&(hasCanonicalIdentity?!moduleRights.DOWNTIME.manage:!["OWNER","DEVACC","ADMIN","SUPERVISOR"].includes(tier)))return json({error:"SCPL MANAGE permission is required to assign or change the DOWNTIME daily operator"},403);
   const dutyDate=String(body.dutyDate||""),requested=String(body.operatorName||"").trim();
   if(!/^\d{4}-\d{2}-\d{2}$/.test(dutyDate)||!Number.isFinite(Date.parse(dutyDate+"T00:00:00Z")))return json({error:"A valid calendar date is required"},400);
   const roster=Array.isArray(bank.staff?.roster)?bank.staff.roster:["Jan","Mick","Gigi","Daz","Shayne"];
   const operator=roster.find((name:any)=>String(name).toLocaleLowerCase()===requested.toLocaleLowerCase());
   if(!operator)return json({error:"Select an operator from the current STAFF roster"},400);
   const {data:existing,error:readError}=await db.from("downtime_daily_operator_assignments").select("*").eq("duty_date",dutyDate).maybeSingle();
   if(readError)return json({error:"Unable to read the daily operator record"},503);
   if(existing?.is_locked)return json({error:"This date already has a locked operator. An authorised supervisor must unlock it before replacement."},409);
   const now=new Date().toISOString();
   const record={duty_date:dutyDate,operator_name:operator,is_locked:true,assigned_by:existing?.assigned_by||currentUser.username,assigned_at:existing?.assigned_at||now,locked_by:currentUser.username,locked_at:now,updated_by:currentUser.username,updated_at:now};
   let write:any=null,writeError:any=null;
   if(existing){
     const {data,error}=await db.from("downtime_daily_operator_assignments").update(record).eq("duty_date",dutyDate).eq("is_locked",false).select("duty_date").maybeSingle();
     write=data;writeError=error;
   }else{
     const {data,error}=await db.from("downtime_daily_operator_assignments").insert(record).select("duty_date").maybeSingle();
     write=data;writeError=error;
   }
   if(writeError||!write)return json({error:"The daily operator record changed in another session. Refresh and retry."},409);
   const actionName=existing?"REASSIGNED":"ASSIGNED";
   const {error:auditError}=await db.from("downtime_daily_operator_audit").insert({duty_date:dutyDate,action:actionName,operator_name:operator,previous_operator:existing?.operator_name||null,actor:currentUser.username,reason:String(body.reason||"").trim().slice(0,240)||null});
   if(auditError)return json({error:"Assignment saved but its audit event could not be recorded. Contact an administrator."},503);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"daily-operator-"+actionName.toLowerCase(),details:{dutyDate,operatorName:operator,previousOperator:existing?.operator_name||null}});
   const centralVersion=await bumpCentralVersion();
   return json({ok:true,record,centralVersion});
 }
 if(action==="daily-operator-unlock"){
   if(!isRootAuthority&&(hasCanonicalIdentity?!moduleRights.DOWNTIME.manage:!["OWNER","DEVACC","ADMIN","SUPERVISOR"].includes(tier)))return json({error:"SCPL MANAGE permission is required to unlock the DOWNTIME daily operator"},403);
   const dutyDate=String(body.dutyDate||""),reason=String(body.reason||"").trim().slice(0,240);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(dutyDate))return json({error:"A valid calendar date is required"},400);
   if(reason.length<4)return json({error:"Enter a reason for unlocking this daily assignment"},400);
   const {data:existing,error:readError}=await db.from("downtime_daily_operator_assignments").select("*").eq("duty_date",dutyDate).maybeSingle();
   if(readError)return json({error:"Unable to read the daily operator record"},503);
   if(!existing||existing.is_locked!==true)return json({error:"There is no locked operator assignment for this date"},409);
   const now=new Date().toISOString();
   const {data:write,error}=await db.from("downtime_daily_operator_assignments").update({is_locked:false,updated_by:currentUser.username,updated_at:now}).eq("duty_date",dutyDate).eq("is_locked",true).select("duty_date").maybeSingle();
   if(error||!write)return json({error:"The daily operator record changed in another session. Refresh and retry."},409);
   const {error:auditError}=await db.from("downtime_daily_operator_audit").insert({duty_date:dutyDate,action:"UNLOCKED",operator_name:existing.operator_name,previous_operator:existing.operator_name,actor:currentUser.username,reason});
   if(auditError)return json({error:"Record unlocked but its audit event could not be recorded. Contact an administrator."},503);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"daily-operator-unlock",details:{dutyDate,operatorName:existing.operator_name,reason}});
   const centralVersion=await bumpCentralVersion();
   return json({ok:true,dutyDate,isLocked:false,updatedBy:currentUser.username,updatedAt:now,centralVersion});
 }
 if(action==="get-state"){const publicBank={...bank,users:priv.canManageUsers||priv.canViewUsers?bank.users.map(safeUser):[safeUser(currentUser)]};const restrictedData={...(publicBank.appData||{})};if(!priv.canDeleteRecords&&priv.canViewDashboards)restrictedData.weeks=addStableRecordIds(restrictedData.weeks||{});if(!priv.canViewStaff&&!priv.canManageStaff&&!priv.canManageAssignments){publicBank.staff={roster:[],profiles:{}};delete restrictedData.staffRoster;delete restrictedData.operatorProfiles;}else if(!priv.canViewStaff&&!priv.canManageStaff&&priv.canManageAssignments){const assignmentProfiles=publicBank.staff?.profiles||{};const minimalProfiles=Object.fromEntries(Object.entries(assignmentProfiles).map(([name,profile]:any)=>[name,{name,onSite:profile?.onSite!==false,station:String(profile?.station||profile?.assignedStation||"").slice(0,100)}]));publicBank.staff={roster:publicBank.staff?.roster||[],profiles:minimalProfiles};restrictedData.staffRoster=publicBank.staff.roster;restrictedData.operatorProfiles=minimalProfiles;}if(!priv.canViewAssignments&&!priv.canManageAssignments){delete restrictedData.assignments;if(restrictedData.weeks){for(const weekData of Object.values(restrictedData.weeks) as any[]){for(const dayData of (weekData?.days||[])){delete dayData.operator;}}}if(priv.canViewStaff||priv.canManageStaff){const hideAssignments=(profiles:any)=>Object.fromEntries(Object.entries(profiles||{}).map(([name,profile]:any)=>{const clean={...profile};delete clean.station;delete clean.assignedStation;return [name,clean]}));publicBank.staff={...publicBank.staff,profiles:hideAssignments(publicBank.staff?.profiles)};restrictedData.operatorProfiles=hideAssignments(restrictedData.operatorProfiles);}}if(!priv.canViewDashboards){delete restrictedData.weeks;delete restrictedData.quickReasons;delete restrictedData.archive;}if(!(priv.canViewAreaPresets||priv.canManageAreaPresets||priv.canManageSettings))delete restrictedData.areas;if(!(priv.canViewReasonPresets||priv.canManageReasonPresets||priv.canAddDowntimeReasons||priv.canManageSettings))delete restrictedData.reasons;if(!(priv.canViewShiftSchedule||priv.canManageShiftSchedule||priv.canManageSettings)){delete restrictedData.shiftSchedule;delete restrictedData.shiftPresets;}if(!(priv.canViewDailyTasks||priv.canManageDailyTasks||priv.canManageSettings))delete restrictedData.dailyTaskPresets;if(!(priv.canViewStations||priv.canViewAssignments||priv.canManageAssignments||priv.canManageSettings))delete restrictedData.stationConfig;if(!priv.canViewReports)delete restrictedData.archive;if(hasCanonicalIdentity&&!isRootAuthority&&!moduleRights.DOWNTIME.view){const staffOnly:any={};for(const field of ["staffRoster","operatorProfiles","staffRoles","stationConfig"])if(Object.prototype.hasOwnProperty.call(restrictedData,field))staffOnly[field]=restrictedData[field];for(const field of Object.keys(restrictedData))delete restrictedData[field];Object.assign(restrictedData,staffOnly);}publicBank.appData=restrictedData;publicBank.statsSource={weeks:priv.canViewDashboards?(restrictedData.weeks||{}):{}};const {data:dailyOperators,error:dailyOperatorError}=await db.from("downtime_daily_operator_assignments").select("duty_date,operator_name,is_locked,assigned_by,assigned_at,locked_by,locked_at,updated_by,updated_at").order("duty_date",{ascending:false}).limit(400);if(dailyOperatorError)return json({error:"Daily operator register is unavailable"},503);const scopedDailyOperators=hasCanonicalIdentity&&!isRootAuthority&&!moduleRights.DOWNTIME.view?[]:(dailyOperators||[]);publicBank.dailyOperators=scopedDailyOperators;return json({payload:publicBank,dailyOperators:scopedDailyOperators,user:safeUser({...currentUser,rootsAuthority,yardRolePermissions:resolvedYardRole?.departments||null}),version:row?.version||0,updatedAt:row?.updated_at});}
 if(action==="save-state"){
   if(!priv.canEditTracker)return json({error:"Permission denied"},403);
   const incoming=body?.appData;if(!incoming||typeof incoming!=="object"||Array.isArray(incoming))return json({error:"appData required"},400);
   const nextAppData={...incoming};
   if(Object.prototype.hasOwnProperty.call(bank.appData||{},"stationConfig"))nextAppData.stationConfig=bank.appData.stationConfig;else delete nextAppData.stationConfig;
   const oldWeeks=bank.appData?.weeks||{};
   const submittedWeeks=incoming.weeks&&typeof incoming.weeks==="object"?incoming.weeks:{};
   const canonicalScpl=hasCanonicalIdentity&&!isRootAuthority;
   const scplRights=resolvedYardRole?.departments?.SCPL||null;
   const keyForEntry=(entry:any,index:number)=> {
     const id=typeof entry?.recordId==="string"?entry.recordId:"";
     return id&&!id.startsWith("legacy-")?"id:"+id:"position:"+index;
   };
   const entryValue=(entry:any)=>{
     const value={...(entry||{})};delete value.recordId;
     return JSON.stringify(value);
   };
   if(canonicalScpl){
     const canView=scplRights?.view===true;
     const canEnter=scplRights?.enter===true;
     const canEdit=scplRights?.edit===true;
     const canManage=scplRights?.manage===true;
     if(canView){
       const weekKeys=new Set([...Object.keys(oldWeeks),...Object.keys(submittedWeeks)]);
       for(const weekKey of weekKeys){
         const oldDays=Array.isArray(oldWeeks[weekKey]?.days)?oldWeeks[weekKey].days:[];
         const newDays=Array.isArray(submittedWeeks[weekKey]?.days)?submittedWeeks[weekKey].days:[];
         const dayCount=Math.max(oldDays.length,newDays.length);
         for(let dayIndex=0;dayIndex<dayCount;dayIndex++){
           const oldEntries=Array.isArray(oldDays[dayIndex]?.entries)?oldDays[dayIndex].entries:[];
           const newEntries=Array.isArray(newDays[dayIndex]?.entries)?newDays[dayIndex].entries:[];
           const oldMap=new Map(oldEntries.map((entry:any,index:number)=>[keyForEntry(entry,index),entry]));
           const newMap=new Map(newEntries.map((entry:any,index:number)=>[keyForEntry(entry,index),entry]));
           for(const [key,newEntry] of newMap){
             if(!oldMap.has(key)&&!canEnter)return json({error:"SCPL INPUT permission is required to add DOWNTIME records."},403);
             if(oldMap.has(key)&&entryValue(oldMap.get(key))!==entryValue(newEntry)&&!canEdit)
               return json({error:"SCPL EDIT permission is required to change DOWNTIME records."},403);
           }
           for(const key of oldMap.keys()){
             if(!newMap.has(key)&&!canManage)return json({error:"SCPL MANAGE permission is required to remove DOWNTIME records."},403);
           }
         }
       }
     }else{
       // Without VIEW, treat omitted records as concealed rather than deleted.
       // Explicit record IDs can still be edited; new IDs can be entered. Existing
       // operational data is merged back from the authoritative server snapshot.
       if(!canEnter&&!canEdit&&!canManage)return json({error:"No Management operational-record write permission is assigned."},403);
       const mergedWeeks=structuredClone(oldWeeks);
       for(const [weekKey,submittedWeek] of Object.entries(submittedWeeks) as [string,any][]){
         const submittedDays=Array.isArray(submittedWeek?.days)?submittedWeek.days:[];
         const mergedWeek:any=mergedWeeks[weekKey]||{days:[]};
         mergedWeek.days=Array.isArray(mergedWeek.days)?mergedWeek.days:[];
         for(let dayIndex=0;dayIndex<submittedDays.length;dayIndex++){
           const submittedDay=submittedDays[dayIndex]||{};
           const submittedEntries=Array.isArray(submittedDay.entries)?submittedDay.entries:[];
           if(!submittedEntries.length)continue;
           const mergedDay:any=mergedWeek.days[dayIndex]||{date:submittedDay.date||null,entries:[]};
           mergedDay.entries=Array.isArray(mergedDay.entries)?mergedDay.entries:[];
           for(const [entryIndex,submittedEntry] of submittedEntries.entries()){
             const key=keyForEntry(submittedEntry,entryIndex);
             const existingIndex=mergedDay.entries.findIndex((entry:any,index:number)=>keyForEntry(entry,index)===key);
             if(existingIndex>=0){
               if(entryValue(mergedDay.entries[existingIndex])!==entryValue(submittedEntry)){
                 if(!canEdit)return json({error:"SCPL EDIT permission is required to change DOWNTIME records."},403);
                 mergedDay.entries[existingIndex]={...submittedEntry,recordId:mergedDay.entries[existingIndex].recordId||submittedEntry.recordId||crypto.randomUUID()};
               }
             }else{
               if(!canEnter)return json({error:"SCPL INPUT permission is required to add DOWNTIME records."},403);
               mergedDay.entries.push({...submittedEntry,recordId:submittedEntry.recordId||crypto.randomUUID()});
             }
           }
           mergedWeek.days[dayIndex]=mergedDay;
         }
         mergedWeeks[weekKey]=mergedWeek;
       }
       nextAppData.weeks=mergedWeeks;
     }
     // The Management YARD ROLE is not an editor for global application settings.
     nextAppData.areas=bank.appData?.areas||[];
     nextAppData.reasons=bank.appData?.reasons||[];
     nextAppData.shiftSchedule=bank.appData?.shiftSchedule||{};
     nextAppData.shiftPresets=bank.appData?.shiftPresets||[];
     nextAppData.dailyTaskPresets=bank.appData?.dailyTaskPresets||[];
     nextAppData.stationConfig=bank.appData?.stationConfig||[];
     nextAppData.staffRoster=bank.appData?.staffRoster||bank.staff?.roster||[];
     nextAppData.operatorProfiles=bank.appData?.operatorProfiles||bank.staff?.profiles||{};
     nextAppData.archive=bank.appData?.archive||[];
   }else if(!priv.canDeleteRecords){
     for(const [weekKey,oldWeek] of Object.entries(oldWeeks) as [string,any][]){
       const newWeek=(submittedWeeks as any)[weekKey];
       const oldDays=Array.isArray(oldWeek?.days)?oldWeek.days:[];
       const newDays=Array.isArray(newWeek?.days)?newWeek.days:[];
       for(let dayIndex=0;dayIndex<oldDays.length;dayIndex++){
         const oldEntries=Array.isArray(oldDays[dayIndex]?.entries)?oldDays[dayIndex].entries:[];
         const newEntries=Array.isArray(newDays[dayIndex]?.entries)?newDays[dayIndex].entries:[];
         for(let entryIndex=0;entryIndex<oldEntries.length;entryIndex++){
           const entry=oldEntries[entryIndex]||{},recordId=typeof entry.recordId==="string"&&entry.recordId?entry.recordId:`legacy-${weekKey}-${dayIndex}-${entryIndex}`;
           if(!newEntries.some((candidate:any)=>candidate?.recordId===recordId))return json({error:"This tier cannot delete operational records. Refresh and retain the original record."},403);
         }
       }
     }
     const oldArchive=Array.isArray(bank.appData?.archive)?bank.appData.archive:[];
     const newArchive=Array.isArray(incoming.archive)?incoming.archive:[];
     if(newArchive.length<oldArchive.length)return json({error:"This tier cannot delete archived records."},403);
   }
   if(!priv.canManageSettings){
     if("areas" in (bank.appData||{}))nextAppData.areas=bank.appData.areas;
     if(Array.isArray(bank.appData?.dailyTaskPresets))nextAppData.dailyTaskPresets=bank.appData.dailyTaskPresets;else delete nextAppData.dailyTaskPresets;
     if("shiftSchedule" in (bank.appData||{}))nextAppData.shiftSchedule=bank.appData.shiftSchedule;else delete nextAppData.shiftSchedule;
     if("shiftPresets" in (bank.appData||{}))nextAppData.shiftPresets=bank.appData.shiftPresets;else delete nextAppData.shiftPresets;
     delete nextAppData.quickReasons;delete nextAppData.recentReasons;
     for(const field of ["reasons"]){
       if(!priv.canAddDowntimeReasons){if(field in (bank.appData||{}))nextAppData[field]=bank.appData[field];continue;}
       const existing=Array.isArray(bank.appData?.[field])?bank.appData[field]:[];
       const incomingValues=Array.isArray(incoming[field])?incoming[field]:existing;
       const additions=incomingValues.filter((value:any)=>typeof value==="string"&&value.trim()&&!existing.some((old:any)=>String(old).trim().toLowerCase()===value.trim().toLowerCase()));
       nextAppData[field]=[...existing,...additions].slice(0,250);
     }
   }
   {
     const currentProfiles=bank.staff?.profiles||bank.appData?.operatorProfiles||{};
     const incomingProfiles=structuredClone(nextAppData.operatorProfiles||{});
     const savedProfiles=priv.canManageStaff?incomingProfiles:structuredClone(currentProfiles||{});
     if(priv.canManageStaff){
       for(const [name,profile] of Object.entries(currentProfiles) as [string,any][]){
         if((profile as any)?.linkedUserId&&!Object.prototype.hasOwnProperty.call(incomingProfiles,name))return json({error:"Linked STAFF profiles cannot be removed through tracker saves. Archive the STAFF profile instead."},409);
       }
       const incomingRoster=Array.isArray(nextAppData.staffRoster)?nextAppData.staffRoster:[];
       for(const [name,profile] of Object.entries(currentProfiles) as [string,any][]){
         if((profile as any)?.linkedUserId&&!incomingRoster.includes(name))return json({error:"Linked STAFF roster entries cannot be removed through tracker saves."},409);
       }
       for(const [name,profile] of Object.entries(incomingProfiles) as [string,any][]){
         const existing=(currentProfiles as any)[name];
         if(!existing&&profile&&typeof profile==="object"&&("staffId" in profile||"linkedUserId" in profile))return json({error:"Tracker saves cannot create STAFF identity links."},400);
       }
     }
     for(const [name,incomingProfile] of Object.entries(incomingProfiles) as [string,any][]){
       if(!Object.prototype.hasOwnProperty.call(currentProfiles,name)||!incomingProfile||typeof incomingProfile!=="object"||Array.isArray(incomingProfile))continue;
       const existing={...(currentProfiles as any)[name]};
       const merged=priv.canManageStaff?{...incomingProfile}:{...existing};
       for(const field of ["staffId","linkedUserId"]){if(Object.prototype.hasOwnProperty.call(existing,field))merged[field]=existing[field];else delete merged[field]}
       // Assignment metadata and its lock can only be changed by the Staff Settings save-settings route.
       if(existing.stationLocked===true||!priv.canManageAssignments){
         if("station" in existing)merged.station=existing.station;else delete merged.station;
         if("assignedStation" in existing)merged.assignedStation=existing.assignedStation;else delete merged.assignedStation;
       }
       if("stationLocked" in existing)merged.stationLocked=existing.stationLocked===true;else delete merged.stationLocked;
       savedProfiles[name]=merged;
     }
     nextAppData.operatorProfiles=savedProfiles;
     if(priv.canManageStaff){
       bank.staff.profiles=savedProfiles;
       bank.staff.roster=Array.isArray(nextAppData.staffRoster)?nextAppData.staffRoster:(bank.staff.roster||[]);
     }else{
       nextAppData.staffRoster=bank.staff.roster||bank.appData?.staffRoster||[];
       bank.staff.profiles=savedProfiles;
     }
   }
   if(!priv.canViewReports||!priv.canDeleteRecords)nextAppData.archive=bank.appData?.archive||[];
   bank.appData=nextAppData;bank.statsSource={weeks:nextAppData.weeks||{}};
   const {data:write,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(body.version)).select("id").maybeSingle();
   if(error||!write)return json({error:"Version conflict; refresh before saving"},409);
   return json({version:(row?.version||0)+1,updatedAt:new Date().toISOString()});
 }
 if(action==="save-settings"){
   const incoming=body?.appData;if(!incoming||typeof incoming!=="object"||Array.isArray(incoming))return json({error:"appData required"},400);
   const canManageAreas=priv.canManageSettings||priv.canManageAreaPresets;
   const canManageReasons=priv.canManageSettings||priv.canManageReasonPresets;
   const canManageSchedule=priv.canManageSettings||priv.canManageShiftSchedule;
   const canManageTasks=priv.canManageSettings||priv.canManageDailyTasks;
   const canManageStaff=!!priv.canManageStaff,canEnterStaff=!!priv.canEnterStaff,canEditStaff=!!priv.canEditStaff,canManageAssignments=!!priv.canManageAssignments,canManageStations=!!priv.canManageSettings;
   const canAddReasons=canManageReasons||!!priv.canAddDowntimeReasons;
   if(!(canManageAreas||canAddReasons||canManageSchedule||canManageTasks||canManageStaff||canEnterStaff||canEditStaff||canManageAssignments||canManageStations))return json({error:"Permission denied"},403);
   const nextAppData={...(bank.appData||{})};
   const cleanList=(value:any,maxItems:number,maxLength:number)=>Array.isArray(value)?value.filter((item:any)=>typeof item==="string"&&item.trim()).slice(0,maxItems).map((item:string)=>item.trim().slice(0,maxLength)):[];
   if(canManageAreas){
     if(!Array.isArray(incoming.areas))return json({error:"Area presets must be an array"},400);
     nextAppData.areas=cleanList(incoming.areas,250,60);
   }
   if(canManageStations&&Object.prototype.hasOwnProperty.call(incoming,"stationConfig")){
     const rawStations=incoming.stationConfig;
     if(!Array.isArray(rawStations)||rawStations.length<1||rawStations.length>100)return json({error:"Station configuration must contain between 1 and 100 stations"},400);
     const stations=rawStations.map((station:any)=>({id:String(station?.id||"").trim().slice(0,80),name:String(station?.name||"").trim().slice(0,40),category:String(station?.category||"GENERAL").trim().toUpperCase().slice(0,24),active:station?.active!==false,aliases:Array.isArray(station?.aliases)?station.aliases.filter((value:any)=>typeof value==="string"&&value.trim()).slice(0,20).map((value:string)=>value.trim().slice(0,80)):[]}));
     const ids=stations.map((station:any)=>station.id),names=stations.map((station:any)=>station.name.toLowerCase());
     if(stations.some((station:any)=>!station.id||!station.name||!station.category)||new Set(ids).size!==ids.length||new Set(names).size!==names.length||!stations.some((station:any)=>station.active))return json({error:"Stations need unique IDs and names, and at least one must remain active"},400);
     nextAppData.stationConfig=stations;
   }
   if(canManageReasons){
     if(!Array.isArray(incoming.reasons))return json({error:"Reason presets must be an array"},400);
     nextAppData.reasons=cleanList(incoming.reasons,250,60);
   }else if(canAddReasons){
     const existing=cleanList(bank.appData?.reasons||[],250,60),incomingReasons=cleanList(incoming.reasons||existing,250,60);
     const additions=incomingReasons.filter((value:string)=>!existing.some((old:string)=>old.toLowerCase()===value.toLowerCase()));
     nextAppData.reasons=[...existing,...additions].slice(0,250);
   }
   if(canManageSchedule){
     if(!incoming.shiftSchedule||typeof incoming.shiftSchedule!=="object"||Array.isArray(incoming.shiftSchedule))return json({error:"Shift schedule must be an object"},400);
     nextAppData.shiftSchedule=incoming.shiftSchedule;
     nextAppData.shiftPresets=Array.isArray(incoming.shiftPresets)?incoming.shiftPresets.filter((p:any)=>p&&typeof p==="object"&&!Array.isArray(p)&&typeof p.name==="string"&&p.config&&typeof p.config==="object").slice(0,50):[];
   }
   if(canManageTasks){
     if(!Array.isArray(incoming.dailyTaskPresets))return json({error:"Daily task presets must be an array"},400);
     nextAppData.dailyTaskPresets=cleanList(incoming.dailyTaskPresets,250,100);
     const allowedTasks=new Set(nextAppData.dailyTaskPresets.map((task:string)=>task.toLowerCase()));
     const weeks=structuredClone(bank.appData?.weeks||{});
     for(const week of Object.values(weeks) as any[]){for(const day of (week?.days||[])){if(Array.isArray(day.dailyTasksDone))day.dailyTasksDone=day.dailyTasksDone.filter((task:any)=>typeof task==='string'&&allowedTasks.has(task.toLowerCase()));}}
     nextAppData.weeks=weeks;
   }
   bank.staff=bank.staff||{roster:[],profiles:{}};
   const currentProfiles=bank.staff.profiles||bank.appData?.operatorProfiles||{};
   const previousStaffRoles=Array.isArray(bank.appData?.staffRoles)?bank.appData.staffRoles:[];
   let staffAuditEvents:any[]=[];
   if(canManageStaff||canEnterStaff||canEditStaff){
     if(incoming.operatorProfiles!==undefined&&(!incoming.operatorProfiles||typeof incoming.operatorProfiles!=="object"||Array.isArray(incoming.operatorProfiles)))return json({error:"Invalid staff profiles"},400);
     if(!Array.isArray(incoming.staffRoster))return json({error:"Invalid staff roster"},400);
     const newProfiles=structuredClone(currentProfiles||{});
     for(const [name,incomingProfile] of Object.entries((incoming.operatorProfiles||{}) as Record<string,any>)){
       const cleanName=String(name||"").trim();
       if(!cleanName||cleanName.length>80||!incomingProfile||typeof incomingProfile!=="object"||Array.isArray(incomingProfile))return json({error:"Invalid staff profile entry"},400);
       const hasExistingProfile=Object.prototype.hasOwnProperty.call(newProfiles,cleanName);
       const existing={...((newProfiles as any)[cleanName]||{})};
       if(!hasExistingProfile&&!canEnterStaff&&!canManageStaff)return json({error:"Management INPUT permission is required to add STAFF profiles."},403);
       if(hasExistingProfile&&!canEditStaff&&!canManageStaff){
         const allowedFields=new Set(["department","onSiteRole","onSite"]);
         if(Object.keys(incomingProfile).some((field:string)=>!allowedFields.has(field)&&JSON.stringify((incomingProfile as any)[field])!==JSON.stringify((existing as any)[field])))return json({error:"Management EDIT permission is required to change this STAFF profile field."},403);
       }
       if(!canManageStaff){
         const allowedFields=hasExistingProfile?new Set(["department","onSiteRole","onSite"]):new Set(["department","onSiteRole","onSite","status"]);
         if(Object.keys(incomingProfile).some((field:string)=>!allowedFields.has(field)&&JSON.stringify((incomingProfile as any)[field])!==JSON.stringify((existing as any)[field])))return json({error:"STAFF INPUT / EDIT does not include photo, archive or identity-link management."},403);
         if(hasExistingProfile&&Object.prototype.hasOwnProperty.call(incomingProfile,"status")&&incomingProfile.status!==existing.status)return json({error:"Management MANAGE permission is required to archive or restore STAFF."},403);
       }
       if(("staffId" in incomingProfile&&incomingProfile.staffId!==existing.staffId)||("linkedUserId" in incomingProfile&&incomingProfile.linkedUserId!==existing.linkedUserId)||"userId" in incomingProfile)return json({error:"STAFF Settings cannot create or alter authenticated USER identity links."},400);
       const profile={...existing,...incomingProfile};
       if(!canManageStaff){
         for(const field of Object.keys(existing))if(!["department","onSiteRole","onSite","status"].includes(field))profile[field]=existing[field];
         for(const field of Object.keys(profile))if(!["department","onSiteRole","onSite","status"].includes(field)&&!Object.prototype.hasOwnProperty.call(existing,field))delete profile[field];
       }
       for(const field of ["staffId","linkedUserId"]){if(Object.prototype.hasOwnProperty.call(existing,field))profile[field]=existing[field];else delete profile[field]}
       const department=String(profile.department||"");
       if(department){
         const departmentRoles:Record<string,string[]>={"SCPL":["Main Operator","Picking Line Crew"],"R&M":["Mechanic"],"Management":["Manager"],"SCFL":["Floor Crew"],"Traffic":["Gateman"]};
         if(!Object.prototype.hasOwnProperty.call(departmentRoles,department))return json({error:"Invalid staff department"},400);
         if(!departmentRoles[department].includes(String(profile.onSiteRole||"")))return json({error:"YARD ROLE does not match the selected department"},400);
         if(department==="SCPL"&&canManageAssignments){
           const requestedStation=String(profile.station??profile.assignedStation??"").trim();
           if(requestedStation){
             const stationConfig=Array.isArray(bank.appData?.stationConfig)?bank.appData.stationConfig:[];
             const selected=stationConfig.find((station:any)=>String(station.id||"")===requestedStation||String(station.name||"").toLowerCase()===requestedStation.toLowerCase()||(String(station.name||"")+" · "+String(station.category||"GENERAL")).toLowerCase()===requestedStation.toLowerCase());
             if(!selected||!/^station-[1-6]$/.test(String(selected.id||"")))return json({error:"SCPL staff may only be assigned to Stations 1-6"},400);
           }
         }else if(department!=="SCPL"&&canManageAssignments){
           profile.station="";
           profile.stationLocked=false;
           delete profile.assignedStation;
         }
       }
       if(!canManageAssignments){
         if(department&&department!=="SCPL"){
           profile.station="";
           profile.stationLocked=false;
           delete profile.assignedStation;
         }else{
           if("station" in existing)profile.station=existing.station;else delete profile.station;
           if("assignedStation" in existing)profile.assignedStation=existing.assignedStation;else delete profile.assignedStation;
           if("stationLocked" in existing)profile.stationLocked=existing.stationLocked;else delete profile.stationLocked;
         }
       }else{
         const wasLocked=existing.stationLocked===true;
         const explicitlyUnlocked=profile.stationLocked===false;
         const requestedStation=String(profile.station??profile.assignedStation??"").slice(0,100);
         const currentStation=String(existing.station??existing.assignedStation??"");
         if(wasLocked&&!explicitlyUnlocked&&requestedStation!==currentStation){
           if("station" in existing)profile.station=existing.station;else delete profile.station;
           if("assignedStation" in existing)profile.assignedStation=existing.assignedStation;else delete profile.assignedStation;
           profile.stationLocked=true;
         }else if(wasLocked&&!explicitlyUnlocked){
           profile.stationLocked=true;
         }else if("stationLocked" in profile){
           profile.stationLocked=profile.stationLocked===true;
         }
       }
       (newProfiles as any)[cleanName]=profile;
     }
     let nextStaffRoles=previousStaffRoles;
     if(incoming.staffRoles!==undefined&&!canManageStaff&&JSON.stringify(incoming.staffRoles)!==JSON.stringify(previousStaffRoles))return json({error:"Management MANAGE permission is required to maintain STAFF role definitions."},403);
     if(incoming.staffRoles!==undefined&&canManageStaff){
       if(!Array.isArray(incoming.staffRoles)||incoming.staffRoles.length<1||incoming.staffRoles.length>100)return json({error:"At least one and no more than 100 on-site roles must be configured"},400);
       nextStaffRoles=incoming.staffRoles.map((role:any)=>typeof role==="string"?role.trim():"");
       if(nextStaffRoles.some((role:string)=>!role||role.length>60)||new Set(nextStaffRoles.map((role:string)=>role.toLowerCase())).size!==nextStaffRoles.length)return json({error:"On-site roles must be unique names of 1–60 characters"},400);
       for(const [name,profile] of Object.entries(newProfiles) as [string,any][]){
         const oldRole=String((currentProfiles as any)?.[name]?.onSiteRole||"");
         if(oldRole&&previousStaffRoles.some((role:string)=>role.toLowerCase()===oldRole.toLowerCase())&&!nextStaffRoles.some((role:string)=>role.toLowerCase()===oldRole.toLowerCase())&&String(profile?.onSiteRole||"").toLowerCase()===oldRole.toLowerCase())return json({error:"Reassign staff using a role before removing it"},409);
       }
     }
     const validateStaffRoster=(value:any,label:string)=>{
      if(!Array.isArray(value))throw new Error(label+" must be an array");
      if(value.length>250)throw new Error(label+" cannot contain more than 250 entries");
      const names:string[]=[],seen=new Set<string>();
      for(const raw of value){
       if(typeof raw!=="string")throw new Error(label+" entries must be text");
       const name=raw.trim();
       if(!name)continue;
       if(name.length>80)throw new Error(label+" entries must be 80 characters or fewer");
       const key=name.toLocaleLowerCase();
       if(!seen.has(key)){seen.add(key);names.push(name);}
      }
      return names;
     };
     let incomingRoster:string[],retainedRoster:string[];
     try{
      incomingRoster=validateStaffRoster(incoming.staffRoster,"Incoming staff roster");
      retainedRoster=validateStaffRoster(bank.staff.roster||bank.appData?.staffRoster||[],"Existing staff roster");
     }catch(error){return json({error:error instanceof Error?error.message:"Invalid staff roster"},400);}
     const rosterMap=new Map<string,string>();
     [...retainedRoster,...incomingRoster].forEach((name:string)=>{const key=name.toLocaleLowerCase();if(!rosterMap.has(key))rosterMap.set(key,name)});
     if(rosterMap.size>250)return json({error:"The combined staff roster cannot exceed 250 entries. No entries were saved."},409);
     nextAppData.operatorProfiles=newProfiles;
     nextAppData.staffRoster=[...rosterMap.values()];
     nextAppData.staffRoles=nextStaffRoles;
     bank.staff.profiles=newProfiles;bank.staff.roster=nextAppData.staffRoster.slice();
     const staffSnapshot=(profile:any)=>profile?{onSiteRole:String(profile.onSiteRole||""),status:String(profile.status||"ACTIVE"),onSite:profile.onSite!==false,station:String(profile.station??profile.assignedStation??""),stationLocked:profile.stationLocked===true}:null;
     const names=new Set([...Object.keys(currentProfiles||{}),...Object.keys(newProfiles||{})]);
     for(const name of names){
       const before=staffSnapshot((currentProfiles as any)?.[name]),after=staffSnapshot((newProfiles as any)?.[name]);
       if(JSON.stringify(before)===JSON.stringify(after))continue;
       const action=!before?"staff-created":after?.status==="ARCHIVED"&&before?.status!=="ARCHIVED"?"staff-archived":before?.status==="ARCHIVED"&&after?.status!=="ARCHIVED"?"staff-restored":"staff-updated";
       staffAuditEvents.push({username:currentUser.username,action,details:{staffName:name,before,after}});
     }
     if(JSON.stringify(previousStaffRoles)!==JSON.stringify(nextStaffRoles))staffAuditEvents.push({username:currentUser.username,action:"staff-roles-updated",details:{before:previousStaffRoles,after:nextStaffRoles}});
   }else if(canManageAssignments){
     const newProfiles=structuredClone(currentProfiles||{});
     for(const [name,profile] of Object.entries((incoming.operatorProfiles||{}) as Record<string,any>)){
       if(!Object.prototype.hasOwnProperty.call(newProfiles,name)||!profile||typeof profile!=="object"||Array.isArray(profile))continue;
       const existing={...(newProfiles as any)[name]};
       const wasLocked=existing.stationLocked===true,hasLockValue="stationLocked" in profile,willBeLocked=hasLockValue?profile.stationLocked===true:wasLocked;
       const requestedStation=String(profile.station??profile.assignedStation??"").slice(0,100);
       const currentStation=String(existing.station??existing.assignedStation??"");
       // Reassigning a locked member requires an explicit unlock in this Staff Settings transaction.
       if(!wasLocked||(hasLockValue&&profile.stationLocked===false)||requestedStation===currentStation){
         if("station" in profile)existing.station=requestedStation;
         else if("assignedStation" in profile)existing.assignedStation=requestedStation;
       }
       if(hasLockValue)existing.stationLocked=willBeLocked;else if(wasLocked)existing.stationLocked=true;
       (newProfiles as any)[name]=existing;
     }
     nextAppData.operatorProfiles=newProfiles;
     nextAppData.staffRoster=bank.staff.roster||bank.appData?.staffRoster||[];
     bank.staff.profiles=newProfiles;
   }
   bank.appData=nextAppData;if(canManageTasks)bank.statsSource={weeks:nextAppData.weeks||{}};
   const {data:commit,error:commitError}=await db.rpc("downtime_commit_central_bank",{
     p_expected_version:Number(body.version),
     p_payload:bank,
     p_username:currentUser.username,
     p_audit_details:{areas:canManageAreas,reasons:canAddReasons,schedule:canManageSchedule,dailyTasks:canManageTasks,staff:canManageStaff,assignments:canManageAssignments,stations:canManageStations},
     p_staff_audit_events:staffAuditEvents.map((event:any)=>({action:event.action,details:event.details}))
   });
   if(commitError)return json({error:"Central settings and audit transaction failed; no changes were committed"},500);
   const committedVersion=Number((commit as any)?.version);
   if(!Number.isInteger(committedVersion))return json({error:"Version conflict; refresh before saving settings"},409);
   return json({ok:true,version:committedVersion,updatedAt:(commit as any).updatedAt||null});
 }
 if(action==="users"){
   if(!priv.canViewUsers&&!priv.canManageUsers)return json({error:"Permission denied"},403);
   return json({users:bank.users.map(safeUser),tiers:bank.tiers});
 }
 if(action==="user-save"){
   if(!priv.canManageUsers)return json({error:"Staff Management MANAGE or immutable DEV authority is required to maintain ordinary USER identities."},403);
   const username=String(body.username||"").trim(),displayName=String(body.displayName||username).trim(),pin=String(body.pin||"");
   if(!/^[A-Za-z0-9_.-]{2,32}$/.test(username))return json({error:"Invalid username"},400);
   if(!displayName||displayName.length>80)return json({error:"Display name must contain 1–80 characters."},400);
   const idx=bank.users.findIndex((u:any)=>u.username.toLowerCase()===username.toLowerCase());
   const existing=idx>=0?bank.users[idx]:null;
   if(!existing)return json({error:"New accounts must use the canonical USER + STAFF + YARD ROLE provisioning workflow."},409);
   const canonicalIdentity=!!existing.userId&&!!existing.staffId;
   if(canonicalIdentity&&body.tier!=null)return json({error:"Canonical YARD ROLE identities cannot receive legacy tier claims."},400);
   const newTier=canonicalIdentity?undefined:String(body.tier||existing.tier||"USER");
   const isRootName=username.toUpperCase()==="DEV";
   if(!isDevRoot){
     if(!canonicalIdentity||!existing.userId||!existing.staffId||body.tier!=null)return json({error:"Management MANAGE can maintain only ordinary canonical USER + STAFF identities; legacy tiers and protected identities remain DEV-controlled."},403);
     if(username.toLowerCase()===currentUser.username.toLowerCase())return json({error:"You cannot change your own USER account."},403);
     const [{data:targetRoots,error:targetRootsError},{data:bootstrap,error:bootstrapError}]=await Promise.all([
       db.from("downtime_roots_assignments").select("roots_class,status").eq("user_id",existing.userId).maybeSingle(),
       db.from("downtime_roots_bootstrap").select("user_id").eq("singleton",true).maybeSingle(),
     ]);
     if(targetRootsError||bootstrapError)return json({error:"Protected ROOTS registry is unavailable."},503);
     if(targetRoots||String(bootstrap?.user_id||"").toLowerCase()===String(existing.userId).toLowerCase())return json({error:"Protected ROOTS identities can only be maintained by immutable DEV."},403);
   }else{
     if(!canonicalIdentity&&(!newTier||!tiers.includes(newTier)))return json({error:"Invalid user/tier"},400);
     if((!existing||newTier!==existing.tier)&&!isCentralAdmin)return json({error:"Only immutable DEV can create accounts or assign user tiers."},403);
   }
   if(isRootName){
     if(!isDevRoot)return json({error:"Only root DEV can update root credentials."},403);
     if(!existing||existing.tier!=="OWNER"||newTier!=="OWNER"||body.enabled===false)return json({error:"DEV is the immutable root OWNER and cannot be created, demoted or disabled."},400);
   }else{
     if(newTier==="OWNER")return json({error:"DEV is the only OWNER account. Additional OWNER accounts are prohibited."},403);
     if(newTier==="DEVACC"&&(!existing||existing.tier!=="DEVACC")&&!isDevRoot)return json({error:"Only immutable DEV can assign DEVACC."},403);
     if(existing?.tier==="DEVACC"&&!isCentralBankAccess)return json({error:"Only immutable DEV can modify DEVACC accounts."},403);
     if(existing?.tier==="OWNER")return json({error:"The root OWNER account is protected."},403);
   }
   if(canonicalIdentity&&displayName!==(existing.displayName||existing.username)){
     try{bank=renameLinkedStaffDisplayName(bank,existing.userId,existing.staffId,displayName).payload}
     catch(error){return json({error:error instanceof Error?error.message:"Linked STAFF display-name update failed."},409)}
   }
   let user=bank.users[idx]||existing||{username};
   user.username=username;user.displayName=displayName;if(canonicalIdentity)delete user.tier;else user.tier=newTier;user.enabled=body.enabled!==false;
   if(pin){if(!/^[0-9]{4,8}$/.test(pin))return json({error:"PIN must be 4-8 digits"},400);user.pinSalt=cryptoHex(crypto.getRandomValues(new Uint8Array(16)));user.pinHash=await hashPin(pin,user.pinSalt)}
   if(idx>=0)bank.users[idx]=user;else{if(!pin)return json({error:"PIN required for new user"},400);bank.users.push(user)}
   const {data:write,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(body.version)).select("id").maybeSingle();
   if(error||!write)return json({error:"Version conflict"},409);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"user-save",details:{target:username,tier:newTier}});
   await db.from("downtime_central_sessions").delete().eq("username",existing?.username||username);
   return json({ok:true,version:(row?.version||0)+1});
 }
 if(action==="user-delete"){
   if(!isDevRoot)return json({error:"Only immutable DEV may perform USER lifecycle operations."},403);
   const target=String(body.username||"").trim();
   if(!target)return json({error:"Username required"},400);
   if(target.toUpperCase()==="DEV"||bank.users.some((u:any)=>u.username.toLowerCase()===target.toLowerCase()&&u.tier==="OWNER"))return json({error:"The DEV root OWNER account cannot be deleted or removed."},403);
   if(bank.users.some((u:any)=>u.username.toLowerCase()===target.toLowerCase()&&u.tier==="DEVACC")&&!isCentralBankAccess)return json({error:"Only immutable DEV can remove DEVACC accounts."},403);
   if(target.toLowerCase()===currentUser.username.toLowerCase())return json({error:"Cannot delete your own account"},400);
   const linkedTarget=bank.users.find((u:any)=>u.username.toLowerCase()===target.toLowerCase());
   if(linkedTarget?.staffId)return json({error:"This USER has a linked STAFF identity. Disable the USER; permanent identity deletion requires the separately approved lifecycle policy."},409);
   bank.users=bank.users.filter((u:any)=>u.username!==target);
   const {data:write,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(body.version)).select("id").maybeSingle();
   if(error||!write)return json({error:"Version conflict"},409);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"user-delete",details:{target}});
   await db.from("downtime_central_sessions").delete().eq("username",target);
   return json({ok:true,version:(row?.version||0)+1});
 }
 if(action==="staff-save"){
   if(!priv.canManageStaff)return json({error:"Management MANAGE permission is required to maintain STAFF profiles."},403);
   const name=String(body.name||"").trim();if(!name||name.length>80)return json({error:"Staff name required"},400);
   bank.staff.profiles=bank.staff.profiles||{};bank.staff.roster=bank.staff.roster||[];
   const existingProfile=bank.staff.profiles[name]||bank.appData?.operatorProfiles?.[name]||{};
   const proposedProfile=body.profile&&typeof body.profile==="object"&&!Array.isArray(body.profile)?body.profile:{};
   if(("staffId" in proposedProfile&&proposedProfile.staffId!==existingProfile.staffId)||("linkedUserId" in proposedProfile&&proposedProfile.linkedUserId!==existingProfile.linkedUserId)||"userId" in proposedProfile)return json({error:"STAFF-only saves cannot create or alter authenticated USER identity links."},400);
   const nextProfile={...existingProfile,...proposedProfile,name};
   for(const field of ["staffId","linkedUserId"]){if(Object.prototype.hasOwnProperty.call(existingProfile,field))nextProfile[field]=existingProfile[field];else delete nextProfile[field]}
   if(!priv.canManageAssignments){
     if("station" in existingProfile)nextProfile.station=existingProfile.station;else delete nextProfile.station;
     if("assignedStation" in existingProfile)nextProfile.assignedStation=existingProfile.assignedStation;else delete nextProfile.assignedStation;
     if("stationLocked" in existingProfile)nextProfile.stationLocked=existingProfile.stationLocked;else delete nextProfile.stationLocked;
   }else{
     const wasLocked=existingProfile.stationLocked===true;
     const hasLockValue=Object.prototype.hasOwnProperty.call(proposedProfile,"stationLocked");
     const explicitlyUnlocked=hasLockValue&&proposedProfile.stationLocked===false;
     if(wasLocked&&!explicitlyUnlocked){
       if("station" in existingProfile)nextProfile.station=existingProfile.station;else delete nextProfile.station;
       if("assignedStation" in existingProfile)nextProfile.assignedStation=existingProfile.assignedStation;else delete nextProfile.assignedStation;
       nextProfile.stationLocked=true;
     }else if(hasLockValue){
       nextProfile.stationLocked=proposedProfile.stationLocked===true;
     }
   }
   bank.staff.profiles[name]=nextProfile;
   if(!bank.staff.roster.includes(name))bank.staff.roster.push(name);
   bank.appData.operatorProfiles=bank.appData.operatorProfiles||{};bank.appData.operatorProfiles[name]=bank.staff.profiles[name];
   bank.appData.staffRoster=bank.staff.roster.slice();
   const {data:write,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(body.version)).select("id").maybeSingle();
   if(error||!write)return json({error:"Version conflict"},409);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"staff-save",details:{name}});
   return json({ok:true,version:(row?.version||0)+1});
 }
 if(action==="staff-original-upload"){
   if(!priv.canManageStaff)return json({error:"Permission denied"},403);
   const slug=String(body.staffKey||"").trim().toLowerCase();
   if(!/^[a-z0-9]{1,30}$/.test(slug))return json({error:"Invalid STAFF destination"},400);
   if(body.mimeType!=="image/png")return json({error:"Only PNG originals are accepted"},415);
   const encoded=String(body.base64||"");
   if(!encoded||encoded.length>7_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return json({error:"PNG upload is missing or exceeds the 5 MB limit"},413);
   let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))}catch{return json({error:"Invalid base64 image"},400)}
   if(bytes.length<8||bytes.length>5*1024*1024)return json({error:"PNG must be between 8 bytes and 5 MB"},413);
   const signature=[137,80,78,71,13,10,26,10];if(signature.some((v,i)=>bytes[i]!==v))return json({error:"PNG signature validation failed"},415);
   const token=Deno.env.get("GITHUB_STAFF_IMAGE_TOKEN");if(!token)return json({error:"GitHub originals upload is not configured on the server"},503);
   const path="assets/staff/originals/"+slug+"/original.png",api="https://api.github.com/repos/aka30art/DOWNTIME/contents/"+path;
   const ghHeaders={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};
   let currentSha:string|undefined;const get=await fetch(api+"?ref=main",{headers:ghHeaders});
   if(get.ok){const current=await get.json();currentSha=current.sha}else if(get.status!==404)return json({error:"GitHub destination lookup failed"},502);
   const payload:any={message:"Update STAFF original photo: "+slug,content:encoded,branch:"main"};if(currentSha)payload.sha=currentSha;
   const put=await fetch(api,{method:"PUT",headers:ghHeaders,body:JSON.stringify(payload)});
   if(!put.ok){let detail="GitHub rejected the image update";try{const err=await put.json();if(err?.message)detail=String(err.message).slice(0,180)}catch{}return json({error:detail},502)}
   const saved=await put.json();await db.from("downtime_central_audit").insert({username:currentUser.username,action:"staff-original-upload",details:{staff:slug,path,bytes:bytes.length,commit:saved?.commit?.sha||null}});
   return json({ok:true,staff:slug,path,commitSha:saved?.commit?.sha||null});
 }
 if(action==="staff-photo-url"){
   if(!priv.canManageStaff)return json({error:"Permission denied"},403);
   const name=String(body.name||"").trim();if(!name)return json({error:"Staff name required"},400);
   const path=name.toLowerCase().replace(/[^a-z0-9_-]/g,"-")+"/"+crypto.randomUUID();
   const {data,error}=await db.storage.from("downtime-staff-photos").createSignedUploadUrl(path);
   if(error)return json({error:error.message},500);
   return json({path,token:data.token,signedUrl:data.signedUrl});
 }
 if(action==="staff-photo-read"){
   const path=String(body.path||"");if(!path||path.length>300)return json({error:"Invalid path"},400);
   if(!priv.canViewStaff&&!priv.canManageStaff)return json({error:"Permission denied"},403);
   const {data,error}=await db.storage.from("downtime-staff-photos").createSignedUrl(path,120);
   if(error)return json({error:error.message},404);
   return json({url:data.signedUrl});
 }
 if(action==="staff-photo-remove"){
   if(!priv.canManageStaff)return json({error:"Permission denied"},403);
   const path=String(body.path||"").trim(),parts=path.split("/");
   if(parts.length!==2||!/^[a-z0-9_-]{1,80}$/i.test(parts[0])||!/^[0-9a-f-]{36}$/i.test(parts[1]))return json({error:"Invalid staff photo path"},400);
   const {error}=await db.storage.from("downtime-staff-photos").remove([path]);
   if(error)return json({error:error.message},500);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"staff-photo-remove",details:{path}});
   return json({ok:true});
 }
 if(action==="set-plant-status"){
   if(!priv.canControlPlantPower)return json({error:"Permission denied"},403);
   if(typeof body.plantOn!=="boolean")return json({error:"plantOn must be boolean"},400);
   bank.appData=bank.appData||{};
   bank.appData.plantOn=body.plantOn;
   const {data:write,error}=await db.from("downtime_central_bank").update({payload:bank,version:(row?.version||0)+1,updated_at:new Date().toISOString()}).eq("id",1).eq("version",Number(body.version)).select("id").maybeSingle();
   if(error||!write)return json({error:"Version conflict; refresh before changing plant status"},409);
   await db.from("downtime_central_audit").insert({username:currentUser.username,action:"set-plant-status",details:{plantOn:body.plantOn}});
   return json({version:(row?.version||0)+1,updatedAt:new Date().toISOString()});
 }
 if(action==="tiers-save"){
   return json({error:"Legacy account-tier permissions are retired. Configure department access through canonical YARD ROLE."},410);
 }
 if(action==="logout"){await db.from("downtime_central_sessions").delete().eq("token_hash",tokenHash);return json({ok:true});}
 return json({error:"Unknown action"},400);
});
