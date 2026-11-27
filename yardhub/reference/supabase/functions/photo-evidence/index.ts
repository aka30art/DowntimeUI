import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cleanup-secret, x-downtime-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const bucket="downtime-evidence";
const department="DOWNTIME";
const maxBytes=5*1024*1024;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recordIdPattern=/^[A-Za-z0-9._:-]{1,180}$/;

async function authorize(req:Request,admin:any,url:string,serviceKey:string){
  const token=(req.headers.get("x-downtime-session")||"").trim();
  if(!token)return {error:"A valid DOWNTIME session is required",status:401};
  let response:Response;
  try{
    response=await fetch(url.replace(/\/$/,"")+"/functions/v1/central-bank",{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":serviceKey,"Authorization":"Bearer "+serviceKey,"x-downtime-session":token},
      body:JSON.stringify({action:"photo-evidence-context"}),
    });
  }catch{return {error:"Central authorization service unavailable",status:503};}
  if(!response.ok){
    if(response.status===401||response.status===403)return {error:"Session invalid or expired",status:401};
    return {error:"Central authorization service unavailable",status:503};
  }
  let result:any;
  try{result=await response.json()}catch{return {error:"Invalid Central authorization response",status:503};}
  const username=String(result?.user?.username||"");
  if(!username)return {error:"Session invalid or expired",status:401};
  const user=result?.user;
  const permissions=result?.permissions;
  if(!user?.username||!permissions)return {error:"Current permission profile unavailable",status:403};
  return {user,permissions};
}

function findOperationalRecord(bank:any,recordId:string|null,attachmentId:string|null){
  const weeks=bank?.appData?.weeks&&typeof bank.appData.weeks==="object"?bank.appData.weeks:{};
  for(const [weekKey,week] of Object.entries(weeks) as [string,any][]){
    const days=Array.isArray(week?.days)?week.days:[];
    for(let dayIndex=0;dayIndex<days.length;dayIndex++){
      const entries=Array.isArray(days[dayIndex]?.entries)?days[dayIndex].entries:[];
      for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
        const entry=entries[entryIndex]||{};
        const currentId=typeof entry.recordId==="string"&&entry.recordId?entry.recordId:`legacy-${weekKey}-${dayIndex}-${entryIndex}`;
        if((recordId&&currentId===recordId&&(!attachmentId||entry.attachmentId===attachmentId))||(!recordId&&attachmentId&&entry.attachmentId===attachmentId))return {recordId:currentId,entry};
      }
    }
  }
  return null;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"POST only"},405);
  const url=Deno.env.get("SUPABASE_URL");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!serviceKey) return json({error:"Server configuration missing"},500);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  let body:any;
  try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
  const action=body?.action;

  // Scheduled cleanup is intentionally independent of browser identity/session access.
  if(action==="cleanup"){
    const secret=Deno.env.get("PHOTO_CLEANUP_SECRET");
    if(!secret||req.headers.get("x-cleanup-secret")!==secret) return json({error:"Forbidden"},403);
    const {data:expired,error}=await admin.from("downtime_attachments").select("id,storage_path").lte("expires_at",new Date().toISOString()).neq("status","deleted").limit(1000);
    if(error)return json({error:error.message},500);
    let deleted=0,failed=0;
    for(const row of expired||[]){
      const {error:storageError}=await admin.storage.from(bucket).remove([row.storage_path]);
      if(storageError){failed++;continue}
      const {error:updateError}=await admin.from("downtime_attachments").update({status:"deleted",deleted_at:new Date().toISOString()}).eq("id",row.id);
      if(updateError)failed++;else deleted++;
    }
    return json({deleted,failed});
  }

  const context:any=await authorize(req,admin,url,serviceKey);
  if(context.error)return json({error:context.error},context.status);
  const user=context.user,permissions=context.permissions;

  if(action==="create-upload"){
    if(permissions.canEditTracker!==true||permissions.canViewDashboards!==true)return json({error:"DOWNTIME input permission required"},403);
    const entryKey=body?.entryKey,recordId=body?.recordId,mime=body?.mimeType,size=Number(body?.size);
    if(!uuidPattern.test(entryKey||""))return json({error:"Invalid photo entry key"},400);
    if(!recordIdPattern.test(recordId||""))return json({error:"A valid operational record ID is required"},400);
    if(!["image/jpeg","image/webp"].includes(mime))return json({error:"Unsupported image type"},415);
    if(!Number.isInteger(size)||size<1||size>maxBytes)return json({error:"File size must be 5MB or less"},413);
    const {data:existing,error:existingError}=await admin.from("downtime_attachments").select("id,storage_path,expires_at,status,record_id").eq("downtime_entry_key",entryKey).maybeSingle();
    if(existingError)return json({error:"Unable to check existing photo evidence"},503);
    if(existing&&existing.record_id!==recordId)return json({error:"Photo entry key is already associated with another operational record"},409);
    if(existing&&existing.status==="available"&&new Date(existing.expires_at)>new Date())return json({error:"An active photo already exists for this entry"},409);
    const attachmentId=crypto.randomUUID(),path=entryKey+"/"+attachmentId+(mime==="image/webp"?".webp":".jpg");
    const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
    if(existing?.storage_path){
      const {error:removeError}=await admin.storage.from(bucket).remove([existing.storage_path]);
      if(removeError)return json({error:"Unable to replace expired photo evidence"},503);
      const {error:deleteError}=await admin.from("downtime_attachments").delete().eq("id",existing.id);
      if(deleteError)return json({error:"Unable to replace expired photo metadata"},503);
    }
    const {data:upload,error:signError}=await admin.storage.from(bucket).createSignedUploadUrl(path,{upsert:false});
    if(signError)return json({error:signError.message},500);
    const {error:insertError}=await admin.from("downtime_attachments").insert({
      id:attachmentId,downtime_entry_key:entryKey,record_id:recordId,department,
      storage_path:path,expires_at:expiresAt,status:"available",mime_type:mime,size_bytes:size
    });
    if(insertError){await admin.storage.from(bucket).remove([path]);return json({error:"Unable to register photo evidence"},500);}
    const {error:auditError}=await admin.from("downtime_central_audit").insert({
      username:user.username,action:"photo-evidence-upload-authorized",
      details:{attachmentId,recordId,department,actorDisplayName:user.displayName}
    });
    if(auditError){
      await admin.from("downtime_attachments").delete().eq("id",attachmentId);
      await admin.storage.from(bucket).remove([path]);
      return json({error:"Unable to record photo evidence authorization"},503);
    }
    return json({attachmentId,path,token:upload.token,signedUrl:upload.signedUrl,expiresAt});
  }

  if(action==="view"){
    if(permissions.canViewDashboards!==true)return json({error:"DOWNTIME read permission required"},403);
    const id=body?.attachmentId;
    if(!uuidPattern.test(id||""))return json({error:"Invalid attachment id"},400);
    const {data:row,error}=await admin.from("downtime_attachments").select("storage_path,expires_at,status,record_id,department").eq("id",id).maybeSingle();
    if(error)return json({error:"Photo evidence metadata unavailable"},503);
    if(!row||row.status!=="available"||new Date(row.expires_at)<=new Date())return json({error:"Photo expired or unavailable"},410);
    if(row.department!==department)return json({error:"Photo belongs to an unavailable department"},403);
    const {data:bankRow,error:bankError}=await admin.from("downtime_central_bank").select("payload").eq("id",1).maybeSingle();
    if(bankError||!bankRow?.payload)return json({error:"Operational record state unavailable"},503);
    const associated=findOperationalRecord(bankRow.payload,row.record_id||null,id);
    if(!associated)return json({error:"Photo is not attached to an active operational record"},404);
    const {data,error:signError}=await admin.storage.from(bucket).createSignedUrl(row.storage_path,60);
    if(signError)return json({error:signError.message},500);
    return json({url:data.signedUrl,expiresIn:60});
  }

  if(action==="delete"){
    if(permissions.canDeleteRecords!==true||permissions.canViewDashboards!==true)return json({error:"Manage permission required to remove photo evidence"},403);
    const id=body?.attachmentId;
    if(!uuidPattern.test(id||""))return json({error:"Invalid attachment id"},400);
    const {data:row,error}=await admin.from("downtime_attachments").select("id,storage_path,record_id,department,status").eq("id",id).maybeSingle();
    if(error)return json({error:"Photo evidence metadata unavailable"},503);
    if(!row||row.status==="deleted")return json({ok:true});
    if(row.department!==department)return json({error:"Photo belongs to an unavailable department"},403);
    const {data:bankRow,error:bankError}=await admin.from("downtime_central_bank").select("payload").eq("id",1).maybeSingle();
    if(bankError||!bankRow?.payload)return json({error:"Operational record state unavailable"},503);
    const associated=row.record_id?findOperationalRecord(bankRow.payload,row.record_id,null):findOperationalRecord(bankRow.payload,null,id);
    if(!associated)return json({error:"Photo is not attached to an active operational record"},404);
    const {error:authorizationAuditError}=await admin.from("downtime_central_audit").insert({
      username:user.username,action:"photo-evidence-delete-authorized",
      details:{attachmentId:id,recordId:associated.recordId,department,actorDisplayName:user.displayName}
    });
    if(authorizationAuditError)return json({error:"Unable to record photo evidence deletion authorization"},503);
    const {error:removeError}=await admin.storage.from(bucket).remove([row.storage_path]);
    if(removeError)return json({error:removeError.message},500);
    const {error:updateError}=await admin.from("downtime_attachments").update({status:"deleted",deleted_at:new Date().toISOString()}).eq("id",id);
    if(updateError)return json({error:"Photo was removed but metadata could not be updated"},503);
    const {error:auditError}=await admin.from("downtime_central_audit").insert({
      username:user.username,action:"photo-evidence-deleted",
      details:{attachmentId:id,recordId:associated.recordId,department,actorDisplayName:user.displayName}
    });
    if(auditError)return json({error:"Photo was removed but the audit event could not be recorded"},503);
    return json({ok:true});
  }
  return json({error:"Unknown action"},400);
});
