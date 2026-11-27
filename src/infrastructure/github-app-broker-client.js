const REQUEST_MARKER = "YARDHUB_REQUEST_V1:";
const RESPONSE_MARKER = "YARDHUB_RESPONSE_V1:";
const PROTOCOL = "YARDHUB_GITHUB_BROKER";
const API_BASE = "https://api.github.com";
const DEVICE_BASE = "https://github.com";
const MAX_ENVELOPE_BYTES = 128 * 1024;

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

function fromBase64Url(value) {
  const raw = requiredString(value, "Base64URL value", /^[A-Za-z0-9_-]+$/).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(raw + "=".repeat((4 - raw.length % 4) % 4));
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
  const bytes = fromBase64Url(encoded);
  if (bytes.byteLength > MAX_ENVELOPE_BYTES) throw new Error("Encrypted broker envelope exceeds the size limit.");
  return decodeJson(bytes, "Encrypted broker envelope");
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Broker request payload must be a JSON object.");
  }
  const id = requiredString(requestId, "Request ID", /^[0-9a-f-]{36}$/i);
  const serverPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(brokerPublicKey));
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
  }, key, utf8(JSON.stringify(payload)));
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
  const clientPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(envelope.clientPublicKey));
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
    iv: fromBase64Url(envelope.nonce),
    additionalData: utf8(PROTOCOL + ":REQUEST:" + envelope.requestId),
    tagLength: 128
  }, key, fromBase64Url(envelope.ciphertext));
  return decodeJson(new Uint8Array(plaintext), "Decrypted broker request");
}

export async function encryptBrokerResponse({
  requestEnvelope,
  payload,
  brokerPrivateKey,
  cryptoProvider = globalThis.crypto
} = {}) {
  if (!cryptoProvider?.subtle || !requestEnvelope || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Broker response parameters are invalid.");
  }
  validateRequestEnvelope(requestEnvelope);
  const clientPublicKey = await importEcdhPublicKey(cryptoProvider.subtle, fromBase64Url(requestEnvelope.clientPublicKey));
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
    name: "AES-GCM", iv: fromBase64Url(envelope.nonce),
    additionalData: utf8(PROTOCOL + ":RESPONSE:" + context.requestId),
    tagLength: 128
  }, key, fromBase64Url(envelope.ciphertext));
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
  now = () => Date.now()
} = {}) {
  const appClientId = requiredString(clientId, "GitHub App client ID");
  const repoId = Number(repositoryId);
  if (!Number.isSafeInteger(repoId) || repoId < 1) throw new TypeError("Broker repository ID is invalid.");
  const repoOwner = requiredString(owner, "Broker repository owner", /^[A-Za-z0-9-]+$/);
  const repoName = requiredString(repository, "Broker repository name", /^[A-Za-z0-9_.-]+$/);
  const issue = Number(issueNumber);
  if (!Number.isSafeInteger(issue) || issue < 1) throw new TypeError("Broker inbox issue number is invalid.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  let device = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let account = null;

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

  async function startDeviceAuthorization() {
    const form = new URLSearchParams({ client_id: appClientId, scope: "offline_access" });
    const result = await request(DEVICE_BASE + "/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    }, "GitHub App device authorisation");
    if (!result?.device_code || !result?.user_code ||
        result.verification_uri !== "https://github.com/login/device" ||
        !Number.isInteger(result.expires_in) || !Number.isInteger(result.interval)) {
      throw new Error("GitHub returned an invalid device authorisation response.");
    }
    device = {
      deviceCode: result.device_code,
      userCode: result.user_code,
      expiresAt: now() + result.expires_in * 1000,
      intervalMs: Math.max(5000, result.interval * 1000),
      nextPollAt: 0
    };
    return {
      userCode: device.userCode,
      verificationUri: result.verification_uri,
      expiresAt: new Date(device.expiresAt).toISOString(),
      intervalMs: device.intervalMs
    };
  }

  async function pollDeviceAuthorization() {
    if (!device) throw new Error("Start GitHub App device authorisation first.");
    if (now() >= device.expiresAt) {
      device = null;
      throw new Error("GitHub App device code expired. Start authorisation again.");
    }
    if (now() < device.nextPollAt) {
      const error = new Error("GitHub App device authorisation must be polled at the returned interval.");
      error.code = "DEVICE_FLOW_INTERVAL";
      error.retryAfterMs = device.nextPollAt - now();
      throw error;
    }
    device.nextPollAt = now() + device.intervalMs;
    const form = new URLSearchParams({
      client_id: appClientId,
      device_code: device.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      repository_id: String(repoId)
    });
    const response = await fetchImpl(DEVICE_BASE + "/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    let result = null;
    try { result = await response.json(); } catch { result = null; }
    if (result?.error === "authorization_pending") return { pending: true, intervalMs: device.intervalMs };
    if (result?.error === "slow_down") {
      device.intervalMs += 5000;
      device.nextPollAt = now() + device.intervalMs;
      return { pending: true, intervalMs: device.intervalMs, slowedDown: true };
    }
    if (result?.error) {
      const reason = result.error;
      device = null;
      throw new Error("GitHub App authorisation failed: " + reason);
    }
    if (!response.ok || !result?.access_token || String(result.token_type).toLowerCase() !== "bearer" ||
        !Number.isInteger(result.expires_in) || result.expires_in < 60) {
      device = null;
      throw new Error("GitHub returned an invalid or non-expiring user access token.");
    }
    accessToken = result.access_token;
    tokenExpiresAt = now() + result.expires_in * 1000;
    device = null;
    const profile = await request(API_BASE + "/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + accessToken, "X-GitHub-Api-Version": "2026-03-10" }
    }, "GitHub user verification");
    if (!Number.isSafeInteger(profile?.id) || !profile?.login) {
      accessToken = null;
      tokenExpiresAt = 0;
      throw new Error("GitHub user identity could not be verified.");
    }
    account = { id: profile.id, login: profile.login };
    return { pending: false, account, expiresAt: new Date(tokenExpiresAt).toISOString() };
  }

  async function submitEncryptedRequest({ payload, brokerPublicKey } = {}) {
    const token = requireToken();
    const context = await createEncryptedBrokerRequest({ payload, brokerPublicKey, cryptoProvider, now: () => new Date(now()) });
    const response = await request(API_BASE + "/repos/" + repoOwner + "/" + repoName + "/issues/" + issue + "/comments", {
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
    return { ...context, commentId: response.id, account };
  }

  async function pollEncryptedResponse(context) {
    const token = requireToken();
    if (!context?.requestId || context.expiresAt && Date.parse(context.expiresAt) <= now()) {
      throw new Error("The pending broker request has expired.");
    }
    const comments = await request(API_BASE + "/repos/" + repoOwner + "/" + repoName + "/issues/" + issue + "/comments?per_page=100&page=1", {
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
        return { pending: false, payload: await decryptBrokerResponse(context, envelope, cryptoProvider), commentId: comment.id };
      }
    }
    return { pending: true };
  }

  function disconnect() {
    accessToken = null;
    tokenExpiresAt = 0;
    account = null;
    device = null;
  }

  return Object.freeze({
    startDeviceAuthorization,
    pollDeviceAuthorization,
    submitEncryptedRequest,
    pollEncryptedResponse,
    disconnect,
    get currentAccount() { return account; },
    get tokenExpiresAt() { return tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null; }
  });
}

export { REQUEST_MARKER as GITHUB_BROKER_REQUEST_MARKER, RESPONSE_MARKER as GITHUB_BROKER_RESPONSE_MARKER };
