/* YARDHUB Central Bank browser adapter.
 * The GitHub data repository is the shared persistence layer. The app-level
 * USER/PIN session is separate from the per-device GitHub repository token.
 */
(function(){
  const SESSION_KEY="yardhub:central-session:v1";
  let runtimeReady=false;
  let session=null;
  const staffPhotoUrls=new Map();
  try{
    const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||"null");
    if(saved&&typeof saved.token==="string"&&saved.token){
      session={authenticated:true,token:saved.token,expiresAt:saved.expiresAt||null,user:saved.user||null};
    }
  }catch{session=null}

  function endpoint(){
    const value=String(window.DOWNTIME_CENTRAL_API||"https://github-native.invalid/functions/v1/central-bank").trim();
    if(!value)throw new Error("Central Bank GitHub endpoint is not configured.");
    return value;
  }
  async function call(action,body={},options={}){
    const headers={"Content-Type":"application/json"};
    if(session?.token&&!options.public)headers["x-downtime-session"]=session.token;
    let response;
    try{response=await fetch(endpoint(),{method:"POST",headers,body:JSON.stringify({action,...body})})}
    catch(error){
      if(window.YARDHUB_GITHUB_OFFLINE===true){
        const offlineError=new Error("OFFLINE — cached data is read-only. This change was not saved to GitHub.");
        offlineError.status=503;offlineError.code="YARDHUB_OFFLINE_NOT_SAVED";throw offlineError;
      }
      throw error;
    }
    let result={};
    try{result=await response.json()}catch{}
    if(!response.ok){
      const error=new Error(result.error||"YARDHUB GitHub data request failed.");
      error.status=response.status;error.code=result.code||"YARDHUB_DATA_REQUEST_FAILED";
      throw error;
    }
    return result;
  }
  function persistSession(){
    try{
      if(session?.token){
        const value=JSON.stringify(session);
        sessionStorage.setItem(SESSION_KEY,value);
        localStorage.setItem(SESSION_KEY,value);
      }else{
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
      }
    }catch{}
  }
  async function configureGitHubRuntime(runtime){
    if(!runtime||typeof runtime.handlers!=="object")throw new TypeError("A running GitHub-native YARDHUB service runtime is required.");
    runtimeReady=true;
    return true;
  }
  async function login(username,pin){
    const result=await call("login",{username,pin},{public:true});
    if(!result?.token)throw new Error("Central login did not return a session token.");
    session={authenticated:true,token:result.token,expiresAt:result.expiresAt||null,user:result.user||null};
    persistSession();
    try{
      const state=await call("get-state");
      session.user=state.user||session.user;session.centralBank=state;
      persistSession();
      return session.user;
    }catch(error){session=null;persistSession();throw error}
  }
  async function completeBrokerLogin(){throw new Error("GitHub App OAuth has been retired. Connect the private GitHub data repository, then sign in with your YARDHUB USER and PIN.")}
  async function logout(){
    try{if(session?.token&&runtimeReady)await call("logout").catch(()=>{})}
    finally{session=null;persistSession()}
    return true;
  }
  async function state(){
    if(window.YARDHUB_GITHUB_OFFLINE===true){
      const database=await window.YARDHUB_GITHUB_STORE?.readDatabase?.();
      const row=database?.tables?.downtime_central_bank?.find(item=>Number(item.id)===1);
      if(!row?.payload||!session?.user)throw new Error("No previously authenticated YARDHUB user is cached for offline viewing.");
      const result={
        payload:row.payload,
        dailyOperators:database.tables.downtime_daily_operator_assignments||[],
        user:session.user,
        version:Number(row.version)||0,
        updatedAt:row.updated_at||database.cachedAt||null,
        offline:true
      };
      session.centralBank=result;persistSession();return result;
    }
    const result=await call("get-state");
    if(session){session.user=result.user||session.user;session.centralBank=result;persistSession()}
    return result;
  }
  async function listUsers(){
    if(window.YARDHUB_GITHUB_OFFLINE===true){
      const database=await window.YARDHUB_GITHUB_STORE?.readDatabase?.();
      const row=database?.tables?.downtime_central_bank?.find(item=>Number(item.id)===1);
      return {users:(row?.payload?.users||[]).map(user=>({username:user.username,displayName:user.displayName||user.name||user.username}))};
    }
    return call("list-users",{}, {public:true});
  }
  const api={
    configureGitHubRuntime,
    configureBroker:configureGitHubRuntime,
    login,
    completeBrokerLogin,
    logout,
    state,
    listUsers,
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
    async uploadStaffOriginal(name,file){
      if(!file)throw new Error("The original PNG file is missing.");
      const bytes=file instanceof Uint8Array?file:new Uint8Array(await file.arrayBuffer());
      if(bytes.byteLength<8||bytes.byteLength>5*1024*1024)throw new Error("PNG must be between 8 bytes and 5 MB.");
      const binaryChunks=[];for(let offset=0;offset<bytes.length;offset+=0x8000)binaryChunks.push(String.fromCharCode(...bytes.subarray(offset,offset+0x8000)));
      const base64=btoa(binaryChunks.join(""));
      const staffKey=String(name||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,30);
      return call("staff-original-upload",{staffKey,mimeType:"image/png",base64});
    },
    async signedStaffPhotoRead(path){return call("staff-photo-read",{path})},
    async removeStaffPhoto(path){return call("staff-photo-remove",{path})},
    async bootstrap(data){return call("bootstrap",data,{public:true})},
    get session(){return session},
    get brokerClient(){return null},
    get githubRuntimeReady(){return runtimeReady}
  };
  window.DowntimeCentral=api;
  window.DowntimeCentral["assign-DailyOperator"]=api.assignDailyOperator;
  window.DowntimeCentral.assign_daily_operator=api.assignDailyOperator;
})();
