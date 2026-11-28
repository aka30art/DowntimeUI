const REQUEST_MARKER = "YARDHUB_REQUEST_V1:";
const RESPONSE_MARKER = "YARDHUB_RESPONSE_V1:";
const PROTOCOL = "YARDHUB_GITHUB_BROKER";
const API_BASE = "https://api.github.com";
const DEVICE_BASE = "https://github.com";
const MAX_ENVELOPE_BYTES = 11 * 1024;
const ACTION_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SERVICE_NAMES = new Set([
  "central-bank", "central-config-admin", "gatelog-api", "photo-evidence",
  "repair-maintenance-api", "spectator-read", "yard-hub-settings-api"
]);

function requiredString(value, label, pattern = null) {
  const result = String(value || "").trim();
  if (!result || result.length > 1024 || (pattern && !pattern.test(result))) {
    throw new TypeError(label + " is invalid.");
  }
  return result;
}

function toBase64Url(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < input.length; offset += 0x8000) {
    binary += String.fromCharCode(...input.subarray(offset, Math.min(offset + 0x8000, input.length)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value, maxBytes = 1024) {
  if (typeof value !== "string" || !value || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      value.length > Math.ceil(maxBytes * 4 / 3) || value.length % 4 === 1 ||
      !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Base64URL value is invalid or exceeds its size limit.");
  }
  const raw = value.replace(/-/g, "+").replace(/_/g, "/");
  let binary;
  try {
    binary = atob(raw + "=".repeat((4 - raw.length % 4) % 4));
  } catch {
    throw new TypeError("Base64URL value is malformed.");
  }
  if (binary.length > maxBytes) throw new TypeError("Base64URL value exceeds its decoded size limit.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

function decodeJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(label + " is not valid JSON.");
  }
}

function buildCommentBody(marker, envelope) {
  const json = JSON.stringify(envelope);
  const bytes = utf8(json);
  if (bytes.byteLength > MAX_ENVELOPE_BYTES) throw new TypeError("Encrypted broker envelope exceeds the size limit.");
  return marker + toBase64Url(bytes);
}

function parseCommentBody(body, marker) {
  if (typeof body !== "string" || !body.startsWith(marker)) return null;
  const encoded = body.slice(marker.length).trim();
  if (encoded.length > Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3)) {
    throw new Error("Encrypted broker envelope exceeds the size limit.");
  }
  const bytes = fromBase64Url(encoded, MAX_ENVELOPE_BYTES);
  return decodeJson(bytes, "Encrypted broker envelope");
}

function isNonExtractableEcdhKey(key, type) {
  return Boolean(key && typeof key === "object" &&
    key.type === type && key.extractable === false &&
    key.algorithm?.name === "ECDH");
}

function validatePendingRequestRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(record.requestId) ||
      !isNonExtractableEcdhKey(record.clientPrivateKey, "private") ||
      !isNonExtractableEcdhKey(record.brokerPublicKey, "public") ||
      !Number.isSafeInteger(record.accountId) || record.accountId < 1 ||
      typeof record.accountLogin !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(record.accountLogin) ||
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      !["SUBMITTING", "SUBMITTED", "SUBMISSION_UNKNOWN"].includes(record.status)) {
    throw new TypeError("Pending broker request record is invalid.");
  }
  if (record.commentId !== null && record.commentId !== undefined &&
      (!Number.isSafeInteger(record.commentId) || record.commentId < 1)) {
    throw new TypeError("Pending broker comment ID is invalid.");
  }
  return {
    requestId: record.requestId,
    clientPrivateKey: record.clientPrivateKey,
    brokerPublicKey: record.brokerPublicKey,
    accountId: record.accountId,
    accountLogin: record.accountLogin,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    commentId: record.commentId ?? null,
    status: record.status
  };
}

/**
 * Persists only encrypted-request recovery material and non-extractable
 * CryptoKeys. It never stores GitHub access tokens, OAuth secrets, plaintext
 * request payloads or operational records.
 */
export function createIndexedDbPendingRequestStore({
  indexedDBProvider = globalThis.indexedDB,
  databaseName = "yardhub-github-broker",
  storeName = "pending-requests",
  now = () => Date.now()
} = {}) {
  if (!indexedDBProvider || typeof indexedDBProvider.open !== "function") {
    throw new Error("IndexedDB is required to recover pending encrypted broker requests.");
  }
  const dbName = requiredString(databaseName, "Pending request database name", /^[A-Za-z0-9_-]{1,80}$/);
  const objectStoreName = requiredString(storeName, "Pending request store name", /^[A-Za-z0-9_-]{1,80}$/);
  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBProvider.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(objectStoreName)) {
          const store = db.createObjectStore(objectStoreName, { keyPath: "requestId" });
          store.createIndex("accountId", "accountId", { unique: false });
          store.createIndex("expiresAt", "expiresAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Pending request database could not be opened."));
      request.onblocked = () => reject(new Error("Pending request database upgrade is blocked by another tab."));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function transact(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let result;
      let settled = false;
      const transaction = db.transaction(objectStoreName, mode);
      const store = transaction.objectStore(objectStoreName);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => {
          if (!settled) {
            settled = true;
            reject(request.error || new Error("Pending request database operation failed."));
          }
        };
      }
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      transaction.onerror = transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error || new Error("Pending request database transaction failed."));
        }
      };
    });
  }

  return Object.freeze({
    async put(record) {
      const safeRecord = validatePendingRequestRecord(record);
      await transact("readwrite", store => store.put(safeRecord));
      return safeRecord.requestId;
    },
    async get(requestId) {
      const id = requiredString(requestId, "Pending request ID", /^[0-9a-f-]{36}$/i);
      const record = await transact("readonly", store => store.get(id));
      if (!record) return null;
      if (Date.parse(record.expiresAt) <= now()) {
        await transact("readwrite", store => store.delete(id));
        return null;
      }
      return validatePendingRequestRecord(record);
    },
    async list(accountId) {
      if (!Number.isSafeInteger(accountId) || accountId < 1) {
        throw new TypeError("A canonical GitHub account ID is required to list pending requests.");
      }
      const records = await transact("readonly", store => store.index("accountId").getAll(accountId));
      const valid = [];
      for (const record of records || []) {
        if (Date.parse(record.expiresAt) <= now()) {
          await transact("readwrite", store => store.delete(record.requestId));
        } else {
          valid.push(validatePendingRequestRecord(record));
        }
      }
      return valid;
    },
    async remove(requestId) {
      const id = requiredString(requestId, "Pending request ID", /^[0-9a-f-]{36}$/i);
      await transact("readwrite", store => store.delete(id));
    },
    async close() {
      if (!databasePromise) return;
      const db = await databasePromise;
      db.close();
      databasePromise = null;
    }
  });
}

async function importEcdhPublicKey(subtle, raw) {
  return subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function deriveDirectionKey({ subtle, privateKey, publicKey, requestId, direction, usage }) {
  const secret = await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const inputKey = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: utf8(requestId),
    info: utf8(PROTOCOL + ":" + direction + ":V1")
  }, inputKey, { name: "AES-GCM", length: 256 }, false, [usage]);
}

function validateRequestEnvelope(envelope, now = () => new Date()) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      envelope.protocol !== PROTOCOL || envelope.version !== 1 ||
      typeof envelope.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(envelope.requestId) ||
      typeof envelope.createdAt !== "string" || typeof envelope.expiresAt !== "string" ||
      typeof envelope.clientPublicKey !== "string" || typeof envelope.nonce !== "string" ||
      typeof envelope.ciphertext !== "string") {
    throw new TypeError("Broker request envelope is invalid.");
  }
  const createdAt = Date.parse(envelope.createdAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const current = now().getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) ||
      expiresAt <= createdAt || expiresAt <= current ||
      createdAt > current + 60_000 || expiresAt - createdAt > 10 * 60_000) {
    throw new Error("Broker request envelope is expired or outside its accepted time window.");
  }
  return envelope;
}

export async function createEncryptedBrokerRequest({
  payload,
  brokerPublicKey,
  cryptoProvider = globalThis.crypto,
  now = () => new Date(),
  requestId = cryptoProvider?.randomUUID?.()
} = {}) {
  if (!cryptoProvider?.subtle || !cryptoProvider?.getRandomValues) {
    throw new Error("WebCrypto is required for encrypted GitHub broker requests.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.service !== "string" || !SERVICE_NAMES.has(payload.service) ||
      typeof payload.action !== "string" || !ACTION_PATTERN.test(payload.action) ||
      (payload.args !== undefined && (!payload.args || typeof payload.args !== "object" || Array.isArray(payload.args))) ||
      payload.sessionToken !== undefined || payload.session_token !== undefined ||
      payload.accessToken !== undefined || payload.access_token !== undefined ||
      payload.authToken !== undefined || payload.auth_token !== undefined ||
      payload.authorization !== undefined || payload.headers !== undefined) {
    throw new TypeError("Broker request payload must contain a registered service, valid action and object args.");
  }
  const id = requiredString(requestId, "Request ID", /^[0-9a-f-]{36}$/i);
  if (payload.requestId && payload.requestId !== id) throw new TypeError("Payload request ID does not match its encrypted envelope.");
  const requestPayload = {
    requestId: id,
    service: payload.service,
    action: payload.action,
    args: payload.args || {}
  };
  const serverPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(brokerPublicKey, 65));
  const pair = await cryptoProvider.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
  const clientPublicKey = toBase64Url(await cryptoProvider.subtle.exportKey("raw", pair.publicKey));
  const key = await deriveDirectionKey({
    subtle: cryptoProvider.subtle,
    privateKey: pair.privateKey,
    publicKey: serverPublicKey,
    requestId: id,
    direction: "REQUEST",
    usage: "encrypt"
  });
  const nonce = new Uint8Array(12);
  cryptoProvider.getRandomValues(nonce);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
  const ciphertext = await cryptoProvider.subtle.encrypt({
    name: "AES-GCM",
    iv: nonce,
    additionalData: utf8(PROTOCOL + ":REQUEST:" + id),
    tagLength: 128
  }, key, utf8(JSON.stringify(requestPayload)));
  const envelope = {
    protocol: PROTOCOL, version: 1, requestId: id,
    createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
    clientPublicKey, nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
  return Object.freeze({
    requestId: id,
    envelope,
    commentBody: buildCommentBody(REQUEST_MARKER, envelope),
    clientPrivateKey: pair.privateKey,
    brokerPublicKey: serverPublicKey,
    expiresAt: expiresAt.toISOString()
  });
}

export async function decryptBrokerRequest({
  envelope,
  brokerPrivateKey,
  cryptoProvider = globalThis.crypto,
  now = () => new Date()
} = {}) {
  if (!cryptoProvider?.subtle) throw new Error("WebCrypto is required for broker decryption.");
  validateRequestEnvelope(envelope, now);
  const clientPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(envelope.clientPublicKey, 65));
  const key = await deriveDirectionKey({
    subtle: cryptoProvider.subtle,
    privateKey: brokerPrivateKey,
    publicKey: clientPublicKey,
    requestId: envelope.requestId,
    direction: "REQUEST",
    usage: "decrypt"
  });
  const plaintext = await cryptoProvider.subtle.decrypt({
    name: "AES-GCM",
    iv: fromBase64Url(envelope.nonce, 12),
    additionalData: utf8(PROTOCOL + ":REQUEST:" + envelope.requestId),
    tagLength: 128
  }, key, fromBase64Url(envelope.ciphertext, MAX_ENVELOPE_BYTES));
  const request = decodeJson(new Uint8Array(plaintext), "Decrypted broker request");
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      request.requestId !== envelope.requestId ||
      typeof request.service !== "string" || !SERVICE_NAMES.has(request.service) ||
      typeof request.action !== "string" || !ACTION_PATTERN.test(request.action) ||
      !request.args || typeof request.args !== "object" || Array.isArray(request.args) ||
      request.sessionToken !== undefined || request.session_token !== undefined ||
      request.accessToken !== undefined || request.access_token !== undefined ||
      request.authToken !== undefined || request.auth_token !== undefined) {
    throw new Error("Decrypted broker request failed service/action schema validation.");
  }
  return request;
}

export async function encryptBrokerResponse({
  requestEnvelope,
  payload,
  brokerPrivateKey,
  cryptoProvider = globalThis.crypto,
  now = () => new Date()
} = {}) {
  if (!cryptoProvider?.subtle || !requestEnvelope || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Broker response parameters are invalid.");
  }
  validateRequestEnvelope(requestEnvelope, now);
  const clientPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(requestEnvelope.clientPublicKey, 65));
  const key = await deriveDirectionKey({
    subtle: cryptoProvider.subtle,
    privateKey: brokerPrivateKey,
    publicKey: clientPublicKey,
    requestId: requestEnvelope.requestId,
    direction: "RESPONSE",
    usage: "encrypt"
  });
  const nonce = new Uint8Array(12);
  cryptoProvider.getRandomValues(nonce);
  const ciphertext = await cryptoProvider.subtle.encrypt({
    name: "AES-GCM", iv: nonce,
    additionalData: utf8(PROTOCOL + ":RESPONSE:" + requestEnvelope.requestId),
    tagLength: 128
  }, key, utf8(JSON.stringify(payload)));
  return {
    protocol: PROTOCOL,
    version: 1,
    requestId: requestEnvelope.requestId,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

export async function decryptBrokerResponse(context, envelope, cryptoProvider = globalThis.crypto) {
  if (!context?.clientPrivateKey || !context?.brokerPublicKey || !context?.requestId ||
      !envelope || envelope.protocol !== PROTOCOL || envelope.version !== 1 ||
      envelope.requestId !== context.requestId ||
      typeof envelope.nonce !== "string" || typeof envelope.ciphertext !== "string") {
    throw new TypeError("Broker response does not match the pending request.");
  }
  const key = await deriveDirectionKey({
    subtle: cryptoProvider.subtle,
    privateKey: context.clientPrivateKey,
    publicKey: context.brokerPublicKey,
    requestId: context.requestId,
    direction: "RESPONSE",
    usage: "decrypt"
  });
  const plaintext = await cryptoProvider.subtle.decrypt({
    name: "AES-GCM", iv: fromBase64Url(envelope.nonce, 12),
    additionalData: utf8(PROTOCOL + ":RESPONSE:" + context.requestId),
    tagLength: 128
  }, key, fromBase64Url(envelope.ciphertext, MAX_ENVELOPE_BYTES));
  return decodeJson(new Uint8Array(plaintext), "Decrypted broker response");
}

export function parseBrokerRequestComment(body) {
  return parseCommentBody(body, REQUEST_MARKER);
}

export function parseBrokerResponseComment(body) {
  return parseCommentBody(body, RESPONSE_MARKER);
}

export function formatBrokerResponseComment(envelope) {
  if (!envelope || envelope.protocol !== PROTOCOL || envelope.version !== 1) {
    throw new TypeError("Broker response envelope is invalid.");
  }
  return buildCommentBody(RESPONSE_MARKER, envelope);
}

export function createGitHubAppBrokerClient({
  clientId,
  repositoryId,
  owner,
  repository,
  issueNumber,
  fetchImpl = globalThis.fetch,
  cryptoProvider = globalThis.crypto,
  now = () => Date.now(),
  storage = globalThis.sessionStorage,
  pendingRequestStore = null
} = {}) {
  const appClientId = requiredString(clientId, "GitHub App client ID");
  const repoId = Number(repositoryId);
  if (!Number.isSafeInteger(repoId) || repoId < 1) throw new TypeError("Broker repository ID is invalid.");
  const repoOwner = requiredString(owner, "Broker repository owner", /^[A-Za-z0-9-]+$/);
  const repoName = requiredString(repository, "Broker repository name", /^[A-Za-z0-9_.-]+$/);
  let issue = issueNumber == null || issueNumber === "" ? 0 : Number(issueNumber);
  if (issue && (!Number.isSafeInteger(issue) || issue < 1)) throw new TypeError("Broker inbox issue number is invalid.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  let accessToken = null;
  let tokenExpiresAt = 0;
  let account = null;
  const authStorage = storage || globalThis.sessionStorage;
  const authStateKey = "yardhub.github-app.oauth-state.v1";
  const localTokenLifetimeMs = 30 * 60 * 1000;
  const pendingStore = pendingRequestStore || (globalThis.indexedDB?.open
    ? createIndexedDbPendingRequestStore({ indexedDBProvider: globalThis.indexedDB, now })
    : null);

  async function request(url, options, label) {
    const response = await fetchImpl(url, options);
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const error = new Error(label + " failed (" + response.status + "): " + String(body?.message || body?.error_description || body?.error || "GitHub request failed").slice(0, 300));
      error.status = response.status;
      error.response = body;
      throw error;
    }
    return body;
  }

  function requireToken() {
    if (!accessToken || tokenExpiresAt <= now()) {
      accessToken = null;
      tokenExpiresAt = 0;
      account = null;
      throw new Error("GitHub App authorisation is missing or expired. Re-authorise the broker inbox.");
    }
    return accessToken;
  }

  function requireInboxIssue() {
    if (!Number.isSafeInteger(issue) || issue < 1) {
      throw new Error("No private YARDHUB inbox issue is resolved for this GitHub account.");
    }
    return issue;
  }

  async function resolveInboxIssue({ label = "yardhub-inbox" } = {}) {
    const token = requireToken();
    if (!account?.id || !account?.login) throw new Error("A verified GitHub account is required to resolve its private inbox.");
    const labelName = requiredString(label, "Broker inbox label", /^[a-z0-9-]{2,64}$/);
    const matches = [];
    for (let page = 1; page <= 5; page += 1) {
      const url = API_BASE + "/repos/" + repoOwner + "/" + repoName +
        "/issues?assignee=" + encodeURIComponent(account.login) +
        "&labels=" + encodeURIComponent(labelName) +
        "&state=open&per_page=100&page=" + page;
      const issues = await request(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2026-03-10"
        }
      }, "Assigned broker inbox lookup");
      if (!Array.isArray(issues)) throw new Error("GitHub returned an invalid assigned inbox list.");
      for (const candidate of issues) {
        const labels = Array.isArray(candidate?.labels)
          ? candidate.labels.map(item => typeof item === "string" ? item : item?.name)
          : [];
        const assignees = Array.isArray(candidate?.assignees) ? candidate.assignees : [];
        if (candidate?.state === "open" && !candidate.pull_request &&
            labels.includes(labelName) && assignees.length === 1 &&
            Number(assignees[0]?.id) === account.id &&
            Number.isSafeInteger(candidate.number) && candidate.number > 0 &&
            Number.isSafeInteger(candidate.id) && candidate.id > 0) {
          matches.push(candidate);
        }
      }
      if (issues.length < 100) break;
    }
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? "No active private YARDHUB inbox is assigned to this GitHub account. Ask DEV to provision it."
        : "More than one private YARDHUB inbox is assigned to this GitHub account. Ask DEV to resolve the duplicate.");
    }
    issue = matches[0].number;
    return Object.freeze({
      issueNumber: issue,
      issueId: matches[0].id,
      title: String(matches[0].title || "").slice(0, 120)
    });
  }

  function randomVerifier() {
    const bytes = new Uint8Array(32);
    cryptoProvider.getRandomValues(bytes);
    return toBase64Url(bytes);
  }

  async function sha256Base64Url(value) {
    const digest = await cryptoProvider.subtle.digest("SHA-256", utf8(value));
    return toBase64Url(new Uint8Array(digest));
  }

  async function startWebAuthorization({ redirectUri, login = null } = {}) {
    if (!cryptoProvider?.subtle || !cryptoProvider?.getRandomValues) {
      throw new Error("WebCrypto is required for GitHub App PKCE authorisation.");
    }
    const callback = requiredString(redirectUri, "GitHub App callback URL");
    const callbackUrl = new URL(callback);
    if (callbackUrl.protocol !== "https:" && callbackUrl.hostname !== "localhost") {
      throw new TypeError("GitHub App callback URL must use HTTPS.");
    }
    if (!authStorage || typeof authStorage.setItem !== "function") {
      throw new Error("Session storage is required for OAuth state and PKCE verification.");
    }
    const state = randomVerifier();
    const codeVerifier = randomVerifier();
    const codeChallenge = await sha256Base64Url(codeVerifier);
    authStorage.setItem(authStateKey, JSON.stringify({
      state, codeVerifier, redirectUri: callbackUrl.toString(), createdAt: now()
    }));
    const authorizeUrl = new URL(DEVICE_BASE + "/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", appClientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("allow_signup", "false");
    if (login) authorizeUrl.searchParams.set("login", requiredString(login, "GitHub login"));
    return Object.freeze({
      authorizationUrl: authorizeUrl.toString(),
      state,
      expiresAt: new Date(now() + 10 * 60 * 1000).toISOString()
    });
  }

  async function completeWebAuthorization({ callbackUrl, clientSecret } = {}) {
    if (!authStorage || typeof authStorage.getItem !== "function" || typeof authStorage.removeItem !== "function") {
      throw new Error("Session storage is required to verify the GitHub App OAuth callback.");
    }
    let stored;
    try { stored = JSON.parse(authStorage.getItem(authStateKey) || "null"); }
    catch { stored = null; }
    const callback = new URL(requiredString(callbackUrl, "GitHub OAuth callback URL"));
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    const oauthError = callback.searchParams.get("error");
    authStorage.removeItem(authStateKey);
    const expectedCallback = stored?.redirectUri ? new URL(stored.redirectUri) : null;
    if (!stored || typeof stored !== "object" || !stored.state || !stored.codeVerifier ||
        typeof state !== "string" || state !== stored.state ||
        now() - stored.createdAt > 10 * 60 * 1000 ||
        !expectedCallback ||
        callback.origin + callback.pathname !== expectedCallback.origin + expectedCallback.pathname) {
      throw new Error("GitHub OAuth state, callback or PKCE session validation failed.");
    }
    if (oauthError) throw new Error("GitHub authorisation was not completed: " + oauthError);
    if (typeof code !== "string" || !code) throw new Error("GitHub OAuth callback did not contain an authorization code.");

    const secret = requiredString(clientSecret, "GitHub App public-client secret");
    const form = new URLSearchParams({
      client_id: appClientId,
      client_secret: secret,
      code,
      redirect_uri: stored.redirectUri,
      code_verifier: stored.codeVerifier,
      repository_id: String(repoId)
    });
    const result = await request(DEVICE_BASE + "/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    }, "GitHub App PKCE token exchange");
    if (!result?.access_token || String(result.token_type).toLowerCase() !== "bearer") {
      throw new Error("GitHub returned an invalid user access token.");
    }
    // This is a public client: the GitHub App client secret is not a security
    // boundary in a static Pages bundle. PKCE, restricted App permissions and
    // the event-derived broker principal are the actual protection.
    const expiresIn = Number.isInteger(result.expires_in) && result.expires_in >= 60
      ? result.expires_in * 1000
      : localTokenLifetimeMs;
    accessToken = result.access_token;
    tokenExpiresAt = now() + Math.min(expiresIn, localTokenLifetimeMs);
    const profile = await request(API_BASE + "/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + accessToken, "X-GitHub-Api-Version": "2026-03-10" }
    }, "GitHub user verification");
    if (!Number.isSafeInteger(profile?.id) || !profile?.login) {
      accessToken = null;
      tokenExpiresAt = 0;
      throw new Error("GitHub user identity could not be verified.");
    }
    account = { id: profile.id, login: profile.login };
    return { account, expiresAt: new Date(tokenExpiresAt).toISOString() };
  }

  function requirePendingStore() {
    if (!pendingStore || typeof pendingStore.put !== "function" ||
        typeof pendingStore.get !== "function" || typeof pendingStore.list !== "function" ||
        typeof pendingStore.remove !== "function") {
      throw new Error("IndexedDB-backed pending request recovery is unavailable; no broker request was submitted.");
    }
    return pendingStore;
  }

  function pendingRecord(context, { commentId = null, status = "SUBMITTING" } = {}) {
    if (!account?.id || !account?.login) throw new Error("A verified GitHub account is required for pending request recovery.");
    return {
      requestId: context.requestId,
      clientPrivateKey: context.clientPrivateKey,
      brokerPublicKey: context.brokerPublicKey,
      accountId: account.id,
      accountLogin: account.login,
      createdAt: now(),
      expiresAt: context.expiresAt,
      commentId,
      status
    };
  }

  async function submitEncryptedRequest({ payload, brokerPublicKey } = {}) {
    const token = requireToken();
    const store = requirePendingStore();
    const context = await createEncryptedBrokerRequest({ payload, brokerPublicKey, cryptoProvider, now: () => new Date(now()) });
    // Save the non-extractable ECDH private key before posting. If the POST
    // outcome is ambiguous, the pending record can be reconciled without
    // resubmitting the operational action or generating a duplicate.
    await store.put(pendingRecord(context, { status: "SUBMITTING" }));
    let response;
    try {
      response = await request(API_BASE + "/repos/" + repoOwner + "/" + repoName + "/issues/" + requireInboxIssue() + "/comments", {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10"
        },
        body: JSON.stringify({ body: context.commentBody })
      }, "Encrypted broker request submission");
      if (!Number.isSafeInteger(response?.id)) throw new Error("GitHub did not return a broker request comment ID.");
      await store.put(pendingRecord(context, { commentId: response.id, status: "SUBMITTED" }));
    } catch (error) {
      await store.put(pendingRecord(context, { status: "SUBMISSION_UNKNOWN" })).catch(() => {});
      throw error;
    }
    return { ...context, commentId: response.id, account };
  }

  async function listPendingRequests() {
    if (!account?.id) throw new Error("Re-authorise GitHub before listing pending broker requests.");
    const store = requirePendingStore();
    const records = await store.list(account.id);
    return records.map(record => ({
      requestId: record.requestId,
      clientPrivateKey: record.clientPrivateKey,
      brokerPublicKey: record.brokerPublicKey,
      expiresAt: record.expiresAt,
      commentId: record.commentId,
      account: { id: record.accountId, login: record.accountLogin }
    }));
  }

  async function restorePendingRequest(requestId) {
    if (!account?.id) throw new Error("Re-authorise GitHub before recovering a pending broker request.");
    const record = await requirePendingStore().get(requestId);
    if (!record || record.accountId !== account.id) {
      throw new Error("No pending request belongs to the currently authorised GitHub account.");
    }
    return {
      requestId: record.requestId,
      clientPrivateKey: record.clientPrivateKey,
      brokerPublicKey: record.brokerPublicKey,
      expiresAt: record.expiresAt,
      commentId: record.commentId,
      account: { id: record.accountId, login: record.accountLogin }
    };
  }

  async function pollEncryptedResponse(context) {
    const token = requireToken();
    if (!context?.requestId || context.expiresAt && Date.parse(context.expiresAt) <= now()) {
      if (context?.requestId) await pendingStore?.remove?.(context.requestId);
      throw new Error("The pending broker request has expired.");
    }
    for (let page = 1; page <= 5; page += 1) {
      const comments = await request(API_BASE + "/repos/" + repoOwner + "/" + repoName + "/issues/" + requireInboxIssue() + "/comments?per_page=100&page=" + page, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2026-03-10"
        }
      }, "Broker response poll");
      if (!Array.isArray(comments)) throw new Error("GitHub returned an invalid broker comment list.");
      for (const comment of comments) {
        const envelope = parseBrokerResponseComment(comment?.body);
        if (envelope?.requestId === context.requestId) {
          const payload = await decryptBrokerResponse(context, envelope, cryptoProvider);
          await pendingStore?.remove?.(context.requestId);
          return { pending: false, payload, commentId: comment.id };
        }
      }
      if (comments.length < 100) break;
    }
    return { pending: true };
  }

  function disconnect() {
    accessToken = null;
    tokenExpiresAt = 0;
    account = null;
  }

  return Object.freeze({
    startWebAuthorization,
    completeWebAuthorization,
    resolveInboxIssue,
    submitEncryptedRequest,
    pollEncryptedResponse,
    listPendingRequests,
    restorePendingRequest,
    disconnect,
    get currentAccount() { return account; },
    get currentInboxIssue() { return issue ? Object.freeze({ issueNumber: issue }) : null; },
    get tokenExpiresAt() { return tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null; }
  });
}

export { REQUEST_MARKER as GITHUB_BROKER_REQUEST_MARKER, RESPONSE_MARKER as GITHUB_BROKER_RESPONSE_MARKER };
