import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createEncryptedBrokerRequest,
  decryptBrokerRequest,
  encryptBrokerResponse,
  decryptBrokerResponse,
  parseBrokerRequestComment,
  parseBrokerResponseComment,
  formatBrokerResponseComment,
  createGitHubAppBrokerClient
} from "../src/infrastructure/github-app-broker-client.js";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

async function brokerKeyPair() {
  return webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
}

test("broker request and response are end-to-end encrypted with ephemeral P-256 ECDH keys", async () => {
  const broker = await brokerKeyPair();
  const brokerPublicKey = base64Url(await webcrypto.subtle.exportKey("raw", broker.publicKey));
  const now = () => new Date("2026-11-27T12:00:00.000Z");
  const payload = {
    action: "gatelog-customer-arrival",
    args: { customer: "Confidential customer", registration: "AB12 CDE", wasteTypes: ["General"] }
  };
  const context = await createEncryptedBrokerRequest({ payload, brokerPublicKey, cryptoProvider: webcrypto, now });
  assert.equal(context.envelope.protocol, "YARDHUB_GITHUB_BROKER");
  assert.equal(context.envelope.version, 1);
  assert.equal(context.envelope.clientPublicKey.length > 40, true);
  assert.ok(context.envelope.expiresAt);
  assert.ok(context.commentBody.startsWith("YARDHUB_REQUEST_V1:"));
  assert.equal(context.commentBody.includes("Confidential customer"), false);

  const parsedRequest = parseBrokerRequestComment(context.commentBody);
  assert.deepEqual(await decryptBrokerRequest({
    envelope: parsedRequest, brokerPrivateKey: broker.privateKey, cryptoProvider: webcrypto, now
  }), { ...payload, requestId: context.requestId });

  const result = { ok: true, visitId: "visit-test-123", message: "Saved" };
  const responseEnvelope = await encryptBrokerResponse({
    requestEnvelope: parsedRequest, payload: result,
    brokerPrivateKey: broker.privateKey, cryptoProvider: webcrypto, now
  });
  const responseComment = formatBrokerResponseComment(responseEnvelope);
  assert.equal(responseComment.includes("visit-test-123"), false);
  assert.deepEqual(await decryptBrokerResponse(
    context, parseBrokerResponseComment(responseComment), webcrypto
  ), result);

  const tampered = { ...responseEnvelope, ciphertext: responseEnvelope.ciphertext.slice(0, -2) + "AA" };
  await assert.rejects(decryptBrokerResponse(context, tampered, webcrypto));
});

test("broker comment envelopes round-trip above 1 KB and reject oversized encoded input before decoding", async () => {
  const broker = await brokerKeyPair();
  const brokerPublicKey = base64Url(await webcrypto.subtle.exportKey("raw", broker.publicKey));
  const now = () => new Date("2026-11-27T12:00:00.000Z");
  const payload = { action: "gatelog-customer-arrival", args: { detail: "x".repeat(2400) } };
  const context = await createEncryptedBrokerRequest({ payload, brokerPublicKey, cryptoProvider: webcrypto, now });
  assert.ok(context.commentBody.length > 1024);
  const parsed = parseBrokerRequestComment(context.commentBody);
  assert.deepEqual(await decryptBrokerRequest({
    envelope: parsed, brokerPrivateKey: broker.privateKey, cryptoProvider: webcrypto, now
  }), { ...payload, requestId: context.requestId });
  assert.throws(
    () => parseBrokerRequestComment("YARDHUB_REQUEST_V1:" + "A".repeat(20_000)),
    /size limit/
  );
});

test("broker rejects expired requests and malformed public comment envelopes", async () => {
  const broker = await brokerKeyPair();
  const brokerPublicKey = base64Url(await webcrypto.subtle.exportKey("raw", broker.publicKey));
  const context = await createEncryptedBrokerRequest({
    payload: { action: "central-state-read", args: {} },
    brokerPublicKey,
    cryptoProvider: webcrypto,
    now: () => new Date("2026-11-27T12:00:00.000Z")
  });
  await assert.rejects(decryptBrokerRequest({
    envelope: context.envelope,
    brokerPrivateKey: broker.privateKey,
    cryptoProvider: webcrypto,
    now: () => new Date("2026-11-27T12:06:00.000Z")
  }), /expired/);
  assert.throws(() => parseBrokerRequestComment("YARDHUB_REQUEST_V1:not-json"), /not valid JSON|Base64URL/i);
});

test("GitHub App Device Flow restricts the user token to the broker repository and posts only ciphertext", async () => {
  let clock = 0;
  let tokenPolls = 0;
  let submittedComment = null;
  let decryptedPayload = null;
  let comments = [];
  const broker = await brokerKeyPair();
  const brokerPublicKey = base64Url(await webcrypto.subtle.exportKey("raw", broker.publicKey));
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const method = options.method || "GET";
    if (String(url).endsWith("/login/device/code") && method === "POST") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("client_id"), "test-client-id");
      assert.equal(form.get("scope"), "offline_access");
      assert.equal(form.has("repository_id"), false, "repository scoping is applied when the access token is minted");
      return reply(200, {
        device_code: "device-code-test",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5
      });
    }
    if (String(url).endsWith("/login/oauth/access_token") && method === "POST") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("client_id"), "test-client-id");
      assert.equal(form.get("device_code"), "device-code-test");
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
      assert.equal(form.get("repository_id"), "12345678");
      tokenPolls += 1;
      if (tokenPolls === 1) return reply(200, { error: "authorization_pending" });
      if (tokenPolls === 2) return reply(200, { error: "slow_down" });
      return reply(200, { access_token: "ghu_test_user_token", token_type: "bearer", expires_in: 28800 });
    }
    if (String(url) === "https://api.github.com/user") {
      assert.equal(options.headers.Authorization, "Bearer ghu_test_user_token");
      return reply(200, { id: 990011, login: "yard-operator" });
    }
    if (String(url).includes("/issues/77/comments") && method === "POST") {
      assert.equal(options.headers.Authorization, "Bearer ghu_test_user_token");
      const body = JSON.parse(options.body);
      submittedComment = body.body;
      assert.match(submittedComment, /^YARDHUB_REQUEST_V1:/);
      assert.equal(submittedComment.includes("Confidential customer"), false);
      const requestEnvelope = parseBrokerRequestComment(submittedComment);
      decryptedPayload = await decryptBrokerRequest({
        envelope: requestEnvelope, brokerPrivateKey: broker.privateKey,
        cryptoProvider: webcrypto, now: () => new Date(clock)
      });
      const responseEnvelope = await encryptBrokerResponse({
        requestEnvelope,
        payload: { ok: true, visitId: "private-visit-id" },
        brokerPrivateKey: broker.privateKey,
        cryptoProvider: webcrypto,
        now: () => new Date(clock)
      });
      comments = [{
        id: 765,
        body: formatBrokerResponseComment(responseEnvelope),
        user: { id: 1, login: "yardhub-broker[bot]" }
      }];
      return reply(201, { id: 765 });
    }
    if (String(url).includes("/issues/77/comments?") && method === "GET") {
      assert.equal(options.headers.Authorization, "Bearer ghu_test_user_token");
      return reply(200, comments);
    }
    return reply(404, { message: "Unexpected test URL" });
  };

  const client = createGitHubAppBrokerClient({
    clientId: "test-client-id",
    repositoryId: 12345678,
    owner: "yardhub",
    repository: "public-broker-inbox",
    issueNumber: 77,
    fetchImpl,
    cryptoProvider: webcrypto,
    now: () => clock
  });

  const device = await client.startDeviceAuthorization();
  assert.equal(device.userCode, "ABCD-EFGH");
  assert.equal(device.verificationUri, "https://github.com/login/device");

  clock = 5000;
  assert.deepEqual(await client.pollDeviceAuthorization(), { pending: true, intervalMs: 5000 });
  clock = 10_000;
  const slowed = await client.pollDeviceAuthorization();
  assert.equal(slowed.pending, true);
  assert.equal(slowed.slowedDown, true);
  assert.equal(slowed.intervalMs, 10_000);
  clock = 20_000;
  const authorised = await client.pollDeviceAuthorization();
  assert.equal(authorised.pending, false);
  assert.deepEqual(authorised.account, { id: 990011, login: "yard-operator" });

  const submitted = await client.submitEncryptedRequest({
    payload: { action: "gatelog-customer-arrival", args: { customer: "Confidential customer" } },
    brokerPublicKey
  });
  assert.equal(submitted.commentId, 765);
  assert.equal(submitted.account.id, 990011);
  assert.equal(decryptedPayload.action, "gatelog-customer-arrival");
  assert.equal(submittedComment.includes("Confidential customer"), false);

  const response = await client.pollEncryptedResponse(submitted);
  assert.equal(response.pending, false);
  assert.deepEqual(response.payload, { ok: true, visitId: "private-visit-id" });

  const accessTokenRequests = calls.filter(call => call.url.endsWith("/login/oauth/access_token"));
  assert.equal(accessTokenRequests.length, 3);
  const repoScopedRequest = accessTokenRequests[2].options.body;
  assert.equal(new URLSearchParams(repoScopedRequest).get("repository_id"), "12345678");
  assert.equal(calls.some(call => call.url.includes("api.github.com/repos/yardhub/private-data")), false);

  client.disconnect();
  assert.equal(client.currentAccount, null);
  await assert.rejects(client.pollEncryptedResponse(submitted), /missing or expired/);
});

console.log("PASS: GitHub App broker client device flow, repo-scoped token, encrypted requests and encrypted response contract");
