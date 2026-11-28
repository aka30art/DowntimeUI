/* YARDHUB Central Bank browser adapter.
 * The GitHub data repository is the shared persistence layer. The app-level
 * USER/PIN session is separate from the per-device GitHub repository token.
 */
(function(){
  const SESSION_KEY="yardhub:central-session:v1";
  let runtimeReady=false;
  let session=null;
  try{
    const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");
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
    if(!runtimeReady)throw new Error("Connect the private GitHub data repository first.");
    const headers={"Content-Type":"application/json"};
    if(session?.token&&!options.public)headers["x-downtime-session"]=session.token;
    const response=await fetch(endpoint(),{method:"POST",headers,body:JSON.stringify({action,...body})});
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
      if(session?.token)sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
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
    const result=await call("get-state");
    if(session){session.user=result.user||session.user;session.centralBank=result;persistSession()}
    return result;
  }
  async function listUsers(){
    const result=await call("list-users",{}, {public:true});
    return result;
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
    async signedStaffPhotoUpload(){const error=new Error("Binary photo upload is not yet included in the GitHub JSON storage phase.");error.code="GITHUB_BINARY_STORAGE_PENDING";error.status=501;throw error},
    async uploadStaffOriginal(){const error=new Error("Original photo upload is not yet included in the GitHub JSON storage phase.");error.code="GITHUB_BINARY_STORAGE_PENDING";error.status=501;throw error},
    async signedStaffPhotoRead(){const error=new Error("Binary photo retrieval is not yet included in the GitHub JSON storage phase.");error.code="GITHUB_BINARY_STORAGE_PENDING";error.status=501;throw error},
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
