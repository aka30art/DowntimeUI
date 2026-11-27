/* DOWNTIME Central Bank browser adapter — API only; no direct bank-table access. */
(function(){
  const endpoint=(window.DOWNTIME_CENTRAL_API||"").trim();
  const apiKey=(window.DOWNTIME_CENTRAL_API_KEY||"").trim();
  const SESSION_KEY="downtime.central.session.v1";
  let session=null;
  try{session=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null")}catch{}
  async function call(action,body={},token=session?.token){
    if(!endpoint)throw new Error("Central API endpoint is not configured.");
    const headers={"Content-Type":"application/json"};
    if(apiKey)headers.apikey=apiKey;
    if(token)headers["x-downtime-session"]=token;
    const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({action,...body})});
    let result={};try{result=await response.json()}catch{}
    if(!response.ok){const error=new Error(result.error||"Central API request failed.");error.status=response.status;throw error;}
    return result;
  }
  window.DowntimeCentral={
    get session(){return session},
    async listUsers(){return call("list-users",{},null)},
    async login(username,pin){const result=await call("login",{username,pin},null);session={token:result.token,expiresAt:result.expiresAt,user:result.user};sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));return result.user},
    async logout(){try{if(session?.token)await call("logout",{},session.token)}finally{session=null;sessionStorage.removeItem(SESSION_KEY)}},
    async state(){return call("get-state")},
    async identityDiagnostics(){return call("identity-diagnostics")},
    async resetIdentities(data){return call("identity-reset",data)},
    async provisionUserStaff(data,version,idempotencyKey){return call("user-staff-provision",{...data,version,idempotencyKey})},
    async activateProvisionedUser(userId,version){return call("user-staff-activate",{userId,version})},
    async dailyOperators(fromDate,toDate){return call("daily-operator-list",{fromDate,toDate})},
    async assignDailyOperator(dutyDate,operatorName,reason=""){return call("daily-operator-assign",{dutyDate,operatorName,reason})},
    async unlockDailyOperator(dutyDate,reason){return call("daily-operator-unlock",{dutyDate,reason})},
    async saveTracker(appData,version){return call("save-state",{appData,version})},
    async saveSettings(appData,version){return call("save-settings",{appData,version})},
    async setPlantStatus(plantOn,version){return call("set-plant-status",{plantOn,version})},
    async saveUser(data,version){return call("user-save",{...data,version})},
    async deleteUser(username,version){return call("user-delete",{username,version})},
    async saveStaff(name,profile,version){return call("staff-save",{name,profile,version})},
    async saveTiers(tiers,version){return call("tiers-save",{tiers,version})},
    async signedStaffPhotoUpload(name){return call("staff-photo-url",{name})},
    async uploadStaffOriginal(name,pngData){const staffKey=String(name||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");if(!/^[a-z0-9]{1,30}$/.test(staffKey))throw new Error("STAFF name cannot be used as a library folder.");const base64=String(pngData||"").replace(/^data:image\/png;base64,/,"");if(!base64||base64.length>7000000)throw new Error("Original PNG exceeds the upload limit (5 MB).");return call("staff-original-upload",{staffKey,mimeType:"image/png",base64})},
    async signedStaffPhotoRead(path){return call("staff-photo-read",{path})},
    async removeStaffPhoto(path){return call("staff-photo-remove",{path})},
    async bootstrap(data){return call("bootstrap",data,null)}
  };
  // Compatibility aliases for previously cached Operator on Duty UI builds.
  window.DowntimeCentral["assign-DailyOperator"]=window.DowntimeCentral.assignDailyOperator;
  window.DowntimeCentral.assign_daily_operator=window.DowntimeCentral.assignDailyOperator;
})();
