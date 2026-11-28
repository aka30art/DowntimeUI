/* Central Bank browser adapter — every request is routed through the encrypted GitHub Actions broker. */
(function(){
  let brokerClient = null;
  let brokerConfig = null;
  let session = null;

  function requireBroker() {
    if (!brokerClient) throw new Error("GitHub broker is not configured.");
    return brokerClient;
  }

  function endpoint() {
    const value = String(window.DOWNTIME_CENTRAL_API || "https://github-native.invalid/functions/v1/central-bank").trim();
    if (!value) throw new Error("Central Bank broker endpoint is not configured.");
    return value;
  }

  async function call(action, body = {}) {
    requireBroker();
    if (!session?.authenticated) throw new Error("Sign in with your provisioned GitHub account first.");
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body })
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(result.error || "Central Bank broker request failed.");
      error.status = response.status;
      error.code = result.code || "CENTRAL_BANK_REQUEST_FAILED";
      throw error;
    }
    return result;
  }

  async function configureBroker(client, config) {
    if (!client || typeof client.startWebAuthorization !== "function" ||
        typeof client.completeWebAuthorization !== "function" ||
        typeof client.resolveInboxIssue !== "function") {
      throw new TypeError("A supported GitHub App broker client is required.");
    }
    brokerClient = client;
    brokerConfig = config || {};
    return true;
  }

  async function login() {
    const client = requireBroker();
    const redirectUri = String(brokerConfig?.redirectUri || (window.location.origin + window.location.pathname));
    const started = await client.startWebAuthorization({ redirectUri });
    window.location.assign(started.authorizationUrl);
    return started;
  }

  async function completeBrokerLogin(callbackUrl = window.location.href) {
    const client = requireBroker();
    const completed = await client.completeWebAuthorization({
      callbackUrl,
      clientSecret: String(brokerConfig?.clientSecret || "")
    });
    const inbox = await client.resolveInboxIssue({ label: brokerConfig?.inboxLabel || "yardhub-inbox" });
    session = {
      authenticated: true,
      account: completed.account,
      expiresAt: completed.expiresAt,
      inbox,
      user: null
    };
    try {
      const result = await call("get-state");
      session.user = result.user || result.currentUser || null;
      session.centralBank = result;
      return session.user;
    } catch (error) {
      session = null;
      throw error;
    }
  }

  async function logout() {
    try { brokerClient?.disconnect?.(); } finally { session = null; }
    return true;
  }

  async function state() {
    const result = await call("get-state");
    if (session) {
      session.user = result.user || result.currentUser || session.user;
      session.centralBank = result;
    }
    return result;
  }

  async function listUsers() {
    const result = await call("users");
    return result;
  }

  function unsupportedBinary(operation) {
    const error = new Error(operation + " is unavailable until secure browser-to-broker binary transport is implemented.");
    error.code = "GITHUB_BINARY_TRANSPORT_UNAVAILABLE";
    error.status = 501;
    throw error;
  }

  const api = {
    configureBroker,
    login,
    completeBrokerLogin,
    logout,
    state,
    listUsers,
    async identityDiagnostics(){ return call("identity-diagnostics"); },
    async resetIdentities(){ unsupportedBinary("Identity reset"); },
    async provisionUserStaff(data,version,idempotencyKey){ return call("user-staff-provision",{...data,version,idempotencyKey}); },
    async activateProvisionedUser(userId,version){ return call("user-staff-activate",{userId,version}); },
    async dailyOperators(fromDate,toDate){ return call("daily-operator-list",{fromDate,toDate}); },
    async assignDailyOperator(dutyDate,operatorName,reason=""){ return call("daily-operator-assign",{dutyDate,operatorName,reason}); },
    async unlockDailyOperator(dutyDate,reason){ return call("daily-operator-unlock",{dutyDate,reason}); },
    async saveTracker(appData,version){ return call("save-state",{appData,version}); },
    async saveSettings(appData,version){ return call("save-settings",{appData,version}); },
    async setPlantStatus(plantOn,version){ return call("set-plant-status",{plantOn,version}); },
    async saveUser(data,version){ return call("user-save",{...data,version}); },
    async deleteUser(username,version){ return call("user-delete",{username,version}); },
    async saveStaff(name,profile,version){ return call("staff-save",{name,profile,version}); },
    async saveTiers(tiers,version){ return call("tiers-save",{tiers,version}); },
    async signedStaffPhotoUpload(){ unsupportedBinary("Staff photo upload"); },
    async uploadStaffOriginal(){ unsupportedBinary("Original staff photo upload"); },
    async signedStaffPhotoRead(){ unsupportedBinary("Staff photo view"); },
    async removeStaffPhoto(path){ return call("staff-photo-remove",{path}); },
    async bootstrap(){ throw new Error("Initial DEV bootstrap is managed by the private GitHub Actions bootstrap workflow."); },
    get session(){ return session; },
    get brokerClient(){ return brokerClient; }
  };

  window.DowntimeCentral = api;
  // Compatibility aliases for previously cached Operator on Duty UI builds.
  window.DowntimeCentral["assign-DailyOperator"] = api.assignDailyOperator;
  window.DowntimeCentral.assign_daily_operator = api.assignDailyOperator;
})();
