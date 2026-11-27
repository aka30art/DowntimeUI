import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { canYardRolePerform, resolveYardRolePermissions } from "../_shared/yard-role-resolver.mjs";
import { resolveRootsAuthority } from "../_shared/roots-authority.mjs";

const allowedOrigin = "https://aka30art.github.io";
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-downtime-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store", "Vary": "Origin", "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers});
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0,max);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return new Response("Forbidden",{status:403});
    return new Response("ok",{headers});
  }
  if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return json({error:"Origin denied"},403);
  if (req.method !== "POST") return json({error:"POST only"},405);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({error:"GATELOG service configuration missing."},500);
  let body:Record<string,unknown>;try{body=await req.json()}catch{return json({error:"Invalid JSON."},400)}
  const token=req.headers.get("x-downtime-session")||"";
  if(!token)return json({error:"Sign in to YARD HUB first."},401);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:session,error:sessionError}=await db.from("downtime_central_sessions").select("username,expires_at").eq("token_hash",await digest(token)).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(sessionError||!session)return json({error:"YARD HUB session expired. Sign in again."},401);
  const {data:bank,error:bankError}=await db.from("downtime_central_bank").select("payload").eq("id",1).maybeSingle();
  if(bankError||!bank?.payload)return json({error:"Central user directory unavailable."},503);
  const user=(Array.isArray(bank.payload.users)?bank.payload.users:[]).find((item:any)=>String(item.username).toLowerCase()===String(session.username).toLowerCase()&&item.enabled!==false);
  if(!user)return json({error:"Account disabled or unavailable."},401);
  const rootsLookup=user.userId
    ? await db.from("downtime_roots_assignments").select("user_id,staff_id,roots_class,status").eq("user_id",user.userId).maybeSingle()
    : {data:null,error:null};
  const {data:rootsBootstrap,error:rootsBootstrapError}=await db.from("downtime_roots_bootstrap").select("user_id").eq("singleton",true).maybeSingle();
  if(rootsLookup.error||rootsBootstrapError||!rootsBootstrap?.user_id)return json({error:"Protected ROOTS identity registry is unavailable."},503);
  const rootsAuthority=resolveRootsAuthority(user,rootsLookup.data,rootsBootstrap.user_id);
  const isProtectedRoot=["DEV","DEV1","ADMIN"].includes(rootsAuthority||"");
  let protectedStaffIds=new Set<string>();
  if(rootsAuthority!=="DEV"){
    const protectedStaff=await db.from("downtime_roots_assignments").select("staff_id").eq("status","ACTIVE");
    if(protectedStaff.error)return json({error:"Protected identity registry is unavailable."},503);
    protectedStaffIds=new Set((protectedStaff.data||[]).map((assignment:any)=>String(assignment.staff_id).toLowerCase()));
  }
  const legacyTier=String(user.tier||"USER").toUpperCase();
  let resolvedYardRole:any=null;
  if(!isProtectedRoot&&user.userId&&user.staffId){
    if(user.enabled!==true||user.status!=="ACTIVE")return json({error:"Canonical USER identity is not active."},403);
    const {data:assignment,error:assignmentError}=await db.from("yard_role_assignments")
      .select("user_id,staff_id,yard_role_id,status").eq("user_id",user.userId).eq("status","ACTIVE").maybeSingle();
    if(assignmentError)return json({error:"Canonical YARD ROLE assignment is unavailable."},503);
    if(!assignment||String(assignment.staff_id).toLowerCase()!==String(user.staffId).toLowerCase())return json({error:"An active linked canonical YARD ROLE assignment is required."},403);
    const [{data:role,error:roleError},{data:rolePermissions,error:rolePermissionsError}]=await Promise.all([
      db.from("yard_roles").select("id,name,description,status").eq("id",assignment.yard_role_id).eq("status","ACTIVE").maybeSingle(),
      db.from("yard_role_department_permissions").select("yard_role_id,department,can_view,can_enter,can_edit,can_manage").eq("yard_role_id",assignment.yard_role_id)
    ]);
    if(roleError||rolePermissionsError||!role)return json({error:"Canonical YARD ROLE permission profile is unavailable."},503);
    try{resolvedYardRole=resolveYardRolePermissions(role,rolePermissions||[])}catch{return json({error:"Canonical YARD ROLE permission profile is invalid."},503)}
  }
  if((user.userId||user.staffId)&&!isProtectedRoot&&!resolvedYardRole)return json({error:"An active canonical YARD ROLE assignment is required."},403);
  const canTrafficView=!!resolvedYardRole&&canYardRolePerform(resolvedYardRole,"Traffic","VIEW");
  const canTrafficInput=!!resolvedYardRole&&canYardRolePerform(resolvedYardRole,"Traffic","ENTER");
  const canTrafficEdit=!!resolvedYardRole&&canYardRolePerform(resolvedYardRole,"Traffic","EDIT");
  const canTrafficManage=!!resolvedYardRole&&canYardRolePerform(resolvedYardRole,"Traffic","MANAGE");
  const legacyCanAccess=bank.payload.tiers?.[legacyTier]?.canAccessYardHub!==false;
  const canAccess=isProtectedRoot||(resolvedYardRole?(canTrafficView||canTrafficInput||canTrafficEdit||canTrafficManage):legacyCanAccess);
  if(!canAccess)return json({error:"YARD HUB access is disabled for this account."},403);
  const actor=clean(user.displayName||user.username,80), action=String(body.action||"");
  const canViewTraffic=isProtectedRoot||(resolvedYardRole?canTrafficView:legacyCanAccess);
  const canManageGateman=isProtectedRoot||(resolvedYardRole?canTrafficManage:bank.payload.tiers?.[legacyTier]?.canManageAssignments===true);
  const canExportReports=isProtectedRoot||(resolvedYardRole?canTrafficView:bank.payload.tiers?.[legacyTier]?.canExportReports===true);
  const canInputTraffic=isProtectedRoot||(resolvedYardRole?canTrafficInput:true);
  const canEditTraffic=isProtectedRoot||(resolvedYardRole?canTrafficEdit:true);
  if(resolvedYardRole){
    if(["customer-arrival","customer-save","vehicle-save","arrival"].includes(action)&&!canInputTraffic)return json({error:"Traffic ENTER permission is required."},403);
    if(["departure","visit-update"].includes(action)&&!canEditTraffic)return json({error:"Traffic EDIT permission is required."},403);
    if(["gateman-save","gateman-lock","report-save","customer-update","customer-archive","waste-type-create","waste-type-update","visit-delete"].includes(action)&&!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
  }
    // Gateman duty is assigned to operational STAFF, never to a USER account.
  const rawStaffRoster=Array.isArray(bank.payload.staff?.roster)?bank.payload.staff.roster:(Array.isArray(bank.payload.appData?.staffRoster)?bank.payload.appData.staffRoster:[]);
  const staffProfiles=bank.payload.staff?.profiles||bank.payload.appData?.operatorProfiles||{};
  const staffRoster=rootsAuthority==="DEV"?rawStaffRoster:rawStaffRoster.filter((name:string)=>!protectedStaffIds.has(String(staffProfiles[name]?.staffId||"").toLowerCase()));
  // Compatibility fields username/tier keep the previous GATELOG client rendering, but their values are derived only from STAFF records.
  const gatemen=staffRoster.filter((name:any)=>typeof name==="string"&&name.trim()).map((name:string)=>({staffName:clean(name,80),username:clean(name,80),displayName:clean(name,120),onSiteRole:clean(staffProfiles[name]?.onSiteRole||"ROLE NOT SET",60),tier:clean(staffProfiles[name]?.onSiteRole||"ROLE NOT SET",60),status:clean(staffProfiles[name]?.status||"ACTIVE",20),onSite:staffProfiles[name]?.onSite!==false})).filter((item:any)=>item.status!=="ARCHIVED"&&item.onSite).sort((a:any,b:any)=>a.displayName.localeCompare(b.displayName));
  const fail=(error:any)=>json({error:error?.message||"GATELOG request failed."},400);

  if(action==="bootstrap"){
    if(resolvedYardRole&&!canViewTraffic){
      const [customers,vehicles,waste]=await Promise.all([
        db.from("gatelog_customers").select("id,customer_name,created_at").eq("active",true).order("customer_name"),
        db.from("gatelog_vehicles").select("id,customer_id,registration").eq("active",true).order("registration"),
        db.from("gatelog_waste_types").select("id,label,active").eq("active",true).order("label"),
      ]);
      if(customers.error||vehicles.error||waste.error)return json({error:"GATELOG reference data could not be loaded."},503);
      return json({customers:customers.data||[],vehicles:vehicles.data||[],wasteTypes:waste.data||[],
        customerStats:{},arrivalsToday:0,departuresToday:0,activeVisits:[],
        statistics:{overallVisits:0,mostCommonWasteType:"—",averageMinutes:null,completedVisits:0},
        periodStatistics:{},dailyGatemen:[],dayVisitCounts:{},gatemen:[],register:[],
        canViewTraffic:false,canInputTraffic,canEditTraffic,canManageGateman,canExportReports:false});
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const todayDate=new Date(today+"T00:00:00Z"),weekStart=new Date(todayDate);weekStart.setUTCDate(weekStart.getUTCDate()-((weekStart.getUTCDay()+6)%7));
    const weekFrom=weekStart.toISOString().slice(0,10),weekTo=new Date(weekStart.getTime()+5*86400000).toISOString().slice(0,10);
    const [customers,vehicles,active,waste,todayVisits,customerStats,overallStats,periodStats,registerRows,weekVisits,gatemanAssignments] = await Promise.all([
      db.from("gatelog_customers").select("id,customer_name,created_at").eq("active",true).order("customer_name"),
      db.from("gatelog_vehicles").select("id,customer_id,registration").eq("active",true).order("registration"),
      db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,status").is("time_out",null).order("time_in",{ascending:false}),
      db.from("gatelog_waste_types").select("id,label,active").eq("active",true).order("label"),
      db.from("gatelog_visits").select("id,status").eq("visit_date",today),
      db.rpc("gatelog_customer_visit_stats"),
      db.rpc("gatelog_overall_statistics"),
      db.rpc("gatelog_period_statistics",{p_today:today}),
      (async()=>{const rows:any[]=[];for(let offset=0;offset<100000;offset+=1000){const page=await db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,time_out,status,gatelog_customers(customer_name),gatelog_visit_waste_types(gatelog_waste_types(label))").eq("visit_date",today).order("time_in",{ascending:false}).range(offset,offset+999);if(page.error)return {data:null,error:page.error};rows.push(...(page.data||[]));if((page.data||[]).length<1000)break;}return {data:rows,error:null};})(),
      (async()=>{const rows:any[]=[];for(let offset=0;offset<100000;offset+=1000){const page=await db.from("gatelog_visits").select("visit_date").gte("visit_date",weekFrom).lte("visit_date",weekTo).range(offset,offset+999);if(page.error)return {data:null,error:page.error};rows.push(...(page.data||[]));if((page.data||[]).length<1000)break;}return {data:rows,error:null};})(),
      db.from("gatelog_daily_gateman_assignments").select("duty_date,gateman_username,gateman_name,is_locked,assigned_by,assigned_at,locked_by,locked_at").gte("duty_date",weekFrom).lte("duty_date",weekTo).order("duty_date",{ascending:true})
    ]);
    const error=[customers,vehicles,active,waste,todayVisits,customerStats,overallStats,periodStats,registerRows,weekVisits,gatemanAssignments].find(x=>x.error)?.error;if(error)return json({error:"GATELOG data could not be loaded."},503);
    const dayVisitCounts:Record<string,number>={};
    (weekVisits.data||[]).forEach((row:any)=>{dayVisitCounts[row.visit_date]=(dayVisitCounts[row.visit_date]||0)+1;});
    const dailyGatemen=Array.from({length:6},(_,index)=>{const date=new Date(weekStart.getTime()+index*86400000).toISOString().slice(0,10);return {duty_date:date,...((gatemanAssignments.data||[]).find((row:any)=>row.duty_date===date)||{gateman_username:null,gateman_name:"Not assigned",is_locked:false})};});
    const customerIds=(customers.data||[]).map((x:any)=>x.id);
    const visits=active.data||[];
    const ids=visits.map((x:any)=>x.id);
    const [visitWaste,customerRows]=await Promise.all([
      ids.length?db.from("gatelog_visit_waste_types").select("visit_id,gatelog_waste_types(label)").in("visit_id",ids):Promise.resolve({data:[],error:null}),
      customerIds.length?db.from("gatelog_customers").select("id,customer_name").in("id",customerIds):Promise.resolve({data:[],error:null})
    ]);
    if(visitWaste.error||customerRows.error)return json({error:"GATELOG relationships could not be loaded."},503);
    return json({customers:customers.data||[],vehicles:vehicles.data||[],customerStats:Object.fromEntries((customerStats.data||[]).map((row:any)=>[row.customer_id,{totalVisits:Number(row.total_visits)||0,todayVisits:Number(row.today_visits)||0}])),arrivalsToday:(todayVisits.data||[]).length,departuresToday:(todayVisits.data||[]).filter((v:any)=>v.status==="DEPARTED").length,activeVisits:visits.map((v:any)=>({...v,customer_name:(customerRows.data||[]).find((c:any)=>c.id===v.customer_id)?.customer_name||"Unknown",waste_types:(visitWaste.data||[]).filter((w:any)=>w.visit_id===v.id).map((w:any)=>w.gatelog_waste_types?.label).filter(Boolean)})),wasteTypes:waste.data||[],statistics:{overallVisits:Number(overallStats.data?.[0]?.total_visits)||0,mostCommonWasteType:overallStats.data?.[0]?.most_common_waste_type||"—",averageMinutes:overallStats.data?.[0]?.average_minutes==null?null:Number(overallStats.data[0].average_minutes),completedVisits:Number(overallStats.data?.[0]?.completed_visits)||0},periodStatistics:Object.fromEntries((periodStats.data||[]).filter((row:any)=>["daily","weekly","monthly"].includes(row.period_key)).map((row:any)=>[row.period_key,{totalVisits:Number(row.total_visits)||0,mostCommonWasteType:row.most_common_waste_type||"—"}])),dailyGatemen,dayVisitCounts,gatemen,canViewTraffic,canInputTraffic,canEditTraffic,canManageGateman,canExportReports,register:(registerRows.data||[]).map((v:any)=>({...v,customer_name:v.gatelog_customers?.customer_name||"Unknown",waste_types:(v.gatelog_visit_waste_types||[]).map((x:any)=>x.gatelog_waste_types?.label).filter(Boolean)}))});
  }
  if(action==="gateman-save"){
    if(!canManageGateman)return json({error:"You do not have permission to manage daily Gateman assignments."},403);
    const dutyDate=clean(body.dutyDate,10),staffName=clean(body.staffName??body.username,80); // username is accepted only as a legacy client field and is still validated exclusively against STAFF.
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dutyDate)||!staffName)return json({error:"Select a valid date and staff member."},400);
    const selected=gatemen.find((item:any)=>item.staffName.toLowerCase()===staffName.toLowerCase());
    if(!selected)return json({error:"The selected staff member is not active in the STAFF directory."},404);
    // The existing RPC argument/column name is retained for backward compatibility; the value is a STAFF name, not a USER username.
    const {data,error}=await db.rpc("gatelog_assign_gateman",{p_duty_date:dutyDate,p_gateman_username:selected.staffName,p_gateman_name:selected.displayName,p_actor:actor});
    if(error)return fail(error);
    const assignment=Array.isArray(data)?data[0]:data;
    if(!assignment)return json({error:"This day's Gateman assignment is locked. It cannot be changed."},409);
    return json({assignment});
  }
  if(action==="gateman-lock"){
    if(!canManageGateman)return json({error:"You do not have permission to lock daily Gateman assignments."},403);
    const dutyDate=clean(body.dutyDate,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dutyDate))return json({error:"Select a valid date."},400);
    const {data,error}=await db.rpc("gatelog_lock_gateman",{p_duty_date:dutyDate,p_actor:actor});
    if(error)return fail(error);
    const assignment=Array.isArray(data)?data[0]:data;
    if(!assignment)return json({error:"Assign a Gateman first, or refresh because this assignment is already locked."},409);
    return json({assignment});
  }
  if(action==="day-register"){
    if(!canViewTraffic)return json({error:"Traffic VIEW permission is required."},403);
    const dutyDate=clean(body.dutyDate,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dutyDate))return json({error:"Select a valid date."},400);
    const rows:any[]=[];for(let offset=0;offset<100000;offset+=1000){const page=await db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,time_out,status,created_by,departed_by,gatelog_customers(customer_name),gatelog_visit_waste_types(gatelog_waste_types(label))").eq("visit_date",dutyDate).order("time_in",{ascending:false}).range(offset,offset+999);if(page.error)return fail(page.error);rows.push(...(page.data||[]));if((page.data||[]).length<1000)break;}
    const visits=rows.map((v:any)=>({...v,customer_name:v.gatelog_customers?.customer_name||"Unknown",waste_types:(v.gatelog_visit_waste_types||[]).map((x:any)=>x.gatelog_waste_types?.label).filter(Boolean)}));
    const {data:assignment,error:assignmentError}=await db.from("gatelog_daily_gateman_assignments").select("gateman_username,gateman_name,is_locked,assigned_by,assigned_at,locked_by,locked_at").eq("duty_date",dutyDate).maybeSingle();
    if(assignmentError)return fail(assignmentError);
    return json({visits,assignment:assignment||{gateman_name:"Not assigned",is_locked:false}});
  }
  if(action==="report"){
    if(!canExportReports)return json({error:"Traffic VIEW permission is required to generate reports."},403);
    const period=clean(body.period,10),anchor=clean(body.anchorDate,10);
    if(!["daily","weekly","monthly"].includes(period)||!/^\d{4}-\d{2}-\d{2}$/.test(anchor))return json({error:"Select a valid report period and date."},400);
    const d=new Date(anchor+"T00:00:00Z");let from=anchor,to=anchor;
    if(period==="weekly"){d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));from=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+5);to=d.toISOString().slice(0,10);}
    if(period==="monthly"){from=anchor.slice(0,7)+"-01";const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));to=end.toISOString().slice(0,10);}
    const reportRows:any[]=[];for(let offset=0;offset<100000;offset+=1000){const page=await db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,time_out,status,created_by,departed_by,gatelog_customers(customer_name),gatelog_visit_waste_types(gatelog_waste_types(label))").gte("visit_date",from).lte("visit_date",to).order("time_in",{ascending:true}).range(offset,offset+999);if(page.error)return fail(page.error);reportRows.push(...(page.data||[]));if((page.data||[]).length<1000)break;}
    const {data:assignments,error:assignmentError}=await db.from("gatelog_daily_gateman_assignments").select("duty_date,gateman_name,is_locked").gte("duty_date",from).lte("duty_date",to).order("duty_date",{ascending:true});
    if(assignmentError)return fail(assignmentError);
    return json({period,from,to,visits:reportRows.map((v:any)=>({...v,customer_name:v.gatelog_customers?.customer_name||"Unknown",waste_types:(v.gatelog_visit_waste_types||[]).map((x:any)=>x.gatelog_waste_types?.label).filter(Boolean)})),assignments:assignments||[]});
  }
  if(action==="report-save"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required to archive reports."},403);
    const period=clean(body.period,10),from=clean(body.from,10),to=clean(body.to,10);
    if(!["daily","weekly","monthly"].includes(period)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(from)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(to)||!Array.isArray(body.visits)||body.visits.length>10000)return json({error:"Invalid report snapshot."},400);
    const snapshot={period,from,to,visits:body.visits,assignments:Array.isArray(body.assignments)?body.assignments:[]};
    const {data,error}=await db.from("gatelog_report_archive").insert({period,date_from:from,date_to:to,report_data:snapshot,created_by:actor}).select("id,period,date_from,date_to,created_by,created_at").single();
    if(error)return fail(error);return json({report:data});
  }
  if(action==="report-archive"){
    if(!canViewTraffic)return json({error:"Traffic VIEW permission is required."},403);
    const {data,error}=await db.from("gatelog_report_archive").select("id,period,date_from,date_to,report_data,created_by,created_at").order("created_at",{ascending:false}).limit(250);
    if(error)return fail(error);return json({reports:data||[]});
  }
  if(action==="customer-update"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
    const id=clean(body.customerId,60),name=clean(body.customerName,120);
    if(!id||!name)return json({error:"Customer and customer name are required."},400);
    const {data,error}=await db.from("gatelog_customers").update({customer_name:name}).eq("id",id).eq("active",true).select("id,customer_name").single();
    if(error)return fail(error);return json({customer:data});
  }
  if(action==="customer-archive"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
    const id=clean(body.customerId,60);if(!id)return json({error:"Customer is required."},400);
    const {data,error}=await db.from("gatelog_customers").update({active:false}).eq("id",id).eq("active",true).select("id").single();
    if(error)return fail(error);return json({archived:true,customerId:data.id});
  }
  if(action==="waste-type-create"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
    const label=clean(body.label,80);if(!label)return json({error:"Waste type label is required."},400);
    const {data,error}=await db.from("gatelog_waste_types").upsert({label,active:true},{onConflict:"label"}).select("id,label,active").single();
    if(error)return fail(error);return json({wasteType:data});
  }
  if(action==="waste-type-update"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
    const id=clean(body.wasteTypeId,60),label=clean(body.label,80),active=body.active===true;
    if(!id||!label)return json({error:"Waste type and label are required."},400);
    const {data,error}=await db.from("gatelog_waste_types").update({label,active}).eq("id",id).select("id,label,active").single();
    if(error)return fail(error);return json({wasteType:data});
  }
  if(action==="customer-arrival"){
    const name=clean(body.customerName,120),registration=clean(body.registration,20).toUpperCase();
    const wasteTypes=Array.isArray(body.wasteTypes)?[...new Set(body.wasteTypes.map((x:any)=>clean(x,80)).filter(Boolean))].slice(0,12):[];
    if(!name||!registration||!wasteTypes.length)return json({error:"Enter a customer/company name, vehicle registration and at least one waste type."},400);
    const {data,error}=await db.rpc("gatelog_create_customer_arrival",{p_customer_name:name,p_registration:registration,p_waste_types:wasteTypes,p_actor:actor});
    if(error)return fail(error);
    const result=Array.isArray(data)?data[0]:data;
    return json({customer:{id:result.customer_id,customer_name:result.customer_name},visit:{id:result.visit_id}});
  }
  if(action==="customer-save"){
    const name=clean(body.customerName,120);if(!name)return json({error:"Customer/company name is required."},400);
    const existing=await db.from("gatelog_customers").select("id,customer_name").ilike("customer_name",name).eq("active",true).maybeSingle();
    if(existing.error)return fail(existing.error);
    if(existing.data)return json({customer:existing.data});
    const {data,error}=await db.from("gatelog_customers").insert({customer_name:name,active:true}).select("id,customer_name").single();
    if(error)return fail(error);
    return json({customer:data});
  }
  if(action==="vehicle-save"){
    const customerId=clean(body.customerId,60),registration=clean(body.registration,20).toUpperCase();
    if(!customerId||!registration)return json({error:"Customer and vehicle registration are required."},400);
    const {data,error}=await db.from("gatelog_vehicles").upsert({customer_id:customerId,registration,active:true},{onConflict:"customer_id,registration"}).select("id,customer_id,registration").single();
    if(error)return fail(error);return json({vehicle:data});
  }
  if(action==="arrival"){
    const customerId=clean(body.customerId,60),registration=clean(body.registration,20).toUpperCase();
    const wasteTypes=Array.isArray(body.wasteTypes)?[...new Set(body.wasteTypes.map((x:any)=>clean(x,80)).filter(Boolean))].slice(0,12):[];
    if(!customerId||!registration||!wasteTypes.length)return json({error:"Select a customer, enter a registration and choose at least one waste type."},400);
    const {data:customer,error:customerError}=await db.from("gatelog_customers").select("id").eq("id",customerId).eq("active",true).maybeSingle();
    if(customerError||!customer)return json({error:"Selected customer was not found."},404);
    const {data:visitId,error:arrivalError}=await db.rpc("gatelog_create_arrival",{p_customer_id:customerId,p_registration:registration,p_waste_types:wasteTypes,p_actor:actor});
    if(arrivalError)return fail(arrivalError);
    const {data:visit,error:visitError}=await db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,status").eq("id",visitId).single();
    if(visitError)return fail(visitError);
    return json({visit});
  }
  if(action==="departure"){
    const visitId=clean(body.visitId,60);if(!visitId)return json({error:"Visit ID is required."},400);
    const {data:rows,error}=await db.rpc("gatelog_register_departure",{p_visit_id:visitId,p_actor:actor});
    if(error)return fail(error);
    const visit=Array.isArray(rows)?rows[0]:rows;
    if(!visit)return json({error:"Visit is no longer on site. Refresh the list."},409);
    return json({visit});
  }
  if(action==="visit-update"){
    const visitId=clean(body.visitId,60),customerId=clean(body.customerId,60),registration=clean(body.registration,20).toUpperCase(),visitDate=clean(body.visitDate,10);
    const timeInRaw=String(body.timeIn||""),timeOutRaw=String(body.timeOut||"");
    const timeIn=new Date(timeInRaw),timeOut=timeOutRaw?new Date(timeOutRaw):null;
    const wasteTypes=Array.isArray(body.wasteTypes)?[...new Set(body.wasteTypes.map((x:any)=>clean(x,80)).filter(Boolean))].slice(0,12):[];
    if(!visitId||!customerId||!registration||!/^\\d{4}-\\d{2}-\\d{2}$/.test(visitDate)||!timeInRaw||!Number.isFinite(timeIn.getTime())||(timeOutRaw&&!Number.isFinite(timeOut?.getTime()))||!wasteTypes.length)return json({error:"Enter a customer, registration, valid visit date and time, and at least one waste type."},400);
    if(timeOut&&timeOut.getTime()<timeIn.getTime())return json({error:"Time Out cannot be earlier than Time In."},400);
    const {data,error}=await db.rpc("gatelog_update_visit",{p_visit_id:visitId,p_customer_id:customerId,p_registration:registration,p_visit_date:visitDate,p_time_in:timeIn.toISOString(),p_time_out:timeOut?timeOut.toISOString():null,p_waste_types:wasteTypes,p_actor:actor});
    if(error)return fail(error);
    if(!data)return json({error:"Visit could not be updated. Refresh the register."},409);
    return json({visitId:data});
  }
  if(action==="visit-delete"){
    if(!canManageGateman)return json({error:"Traffic MANAGE permission is required."},403);
    const visitId=clean(body.visitId,60);
    if(!visitId)return json({error:"Visit ID is required."},400);
    const {data,error}=await db.rpc("gatelog_delete_visit",{p_visit_id:visitId,p_actor:actor});
    if(error)return fail(error);
    if(!data)return json({error:"Visit was not found or has already been removed."},409);
    return json({visitId:data,deleted:true});
  }
  if(action==="history"){
    if(!canViewTraffic)return json({error:"Traffic VIEW permission is required."},403);
    const term=clean(body.search,100);
    let query=db.from("gatelog_visits").select("id,customer_id,vehicle_registration_snapshot,visit_date,time_in,time_out,status,created_by,departed_by,gatelog_customers(customer_name),gatelog_visit_waste_types(gatelog_waste_types(label))").order("time_in",{ascending:false}).limit(250);
    if(body.date)query=query.eq("visit_date",clean(body.date,10));
    const {data,error}=await query;if(error)return fail(error);
    const rows=(data||[]).map((v:any)=>({...v,customer_name:v.gatelog_customers?.customer_name||"Unknown",waste_types:(v.gatelog_visit_waste_types||[]).map((x:any)=>x.gatelog_waste_types?.label).filter(Boolean)}));
    return json({visits:term?rows.filter((v:any)=>[v.customer_name,v.vehicle_registration_snapshot,...v.waste_types].join(" ").toLowerCase().includes(term.toLowerCase())):rows});
  }
  return json({error:"Unknown GATELOG action."},400);
});
