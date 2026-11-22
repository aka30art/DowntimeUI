export function resolveRole(roles=[],roleId){
  return (Array.isArray(roles)?roles:[]).find(role=>role?.id===roleId)||null;
}
export function hasPermission(roles=[],roleId,permission){
  if(typeof permission!=="string"||!permission.trim())return false;
  const role=resolveRole(roles,roleId);
  return role?.permissions?.[permission]===true;
}
export function canAccessSection(roles=[],roleId,{viewPermission,managePermission}={}){
  return Boolean((viewPermission&&hasPermission(roles,roleId,viewPermission))||
    (managePermission&&hasPermission(roles,roleId,managePermission)));
}
export function authorizeAction(roles=[],roleId,permission){
  return hasPermission(roles,roleId,permission)
    ?{ok:true}
    :{ok:false,code:"FORBIDDEN",message:"This role does not have permission to perform this action."};
}
export function validateRole(role){
  if(!role||typeof role!=="object")return ["Role must be an object."];
  const errors=[];
  if(typeof role.id!=="string"||!role.id.trim())errors.push("Role needs a stable ID.");
  if(typeof role.name!=="string"||!role.name.trim())errors.push("Role needs a name.");
  if(!role.permissions||typeof role.permissions!=="object"||Array.isArray(role.permissions))errors.push("Role permissions must be an object.");
  else for(const [key,value] of Object.entries(role.permissions))if(typeof value!=="boolean")errors.push("Permission "+key+" must be true or false.");
  return errors;
}
/* This is a client-side policy helper only. All protected operations must also be authorised by the server. */


/*
 * Platform-level Central Data Bank access is intentionally separate from tenant
 * roles. A trusted server-issued identity claim is required; tenant configuration
 * must never be able to grant this capability.
 */
export function canAccessCentralDataBank(principal){
  return Boolean(principal&&principal.active===true&&
    typeof principal.userId==="string"&&principal.userId.trim()&&
    principal.systemRole==="platform-admin");
}
export function authorizeCentralDataBank(principal){
  return canAccessCentralDataBank(principal)
    ?{ok:true}
    :{ok:false,code:"PLATFORM_ADMIN_REQUIRED",message:"Central Data Bank access is restricted to an authenticated platform administrator."};
}
