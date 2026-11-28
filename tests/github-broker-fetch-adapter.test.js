import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubBrokerFetchAdapter } from "../src/infrastructure/github-broker-fetch-adapter.js";

function makeBroker({ responses = [], submitError = null } = {}) {
  const calls = { submitted: [], polled: 0 };
  return {
    calls,
    async submitEncryptedRequest(args) {
      calls.submitted.push(args);
      if (submitError) throw submitError;
      return { requestId: "10fd938a-2107-4b8a-ade1-ba77bc542182", expiresAt: "2026-11-28T12:05:00.000Z" };
    },
    async pollEncryptedResponse() {
      calls.polled += 1;
      return responses.shift() || { pending: true };
    }
  };
}

test("broker fetch adapter translates Edge POSTs into encrypted service/action requests and restores the Edge response", async () => {
  const broker = makeBroker({
    responses: [
      { pending: true },
      {
        pending: false,
        payload: {
          ok: true,
          requestId: "10fd938a-2107-4b8a-ade1-ba77bc542182",
          result: { status: 201, body: { ok: true, visitId: "visit-01" }, revision: 8 }
        }
      }
    ]
  });
  let clock = 1000;
  const adapter = createGitHubBrokerFetchAdapter({
    brokerClient: broker,
    brokerPublicKey: "broker-public-key",
    fetchImpl: async () => { throw new Error("Native fetch must not be used for broker routes."); },
    now: () => clock,
    sleep: async ms => { clock += ms; },
    maxWaitMs: 5000,
    initialPollMs: 50,
    maxPollMs: 100
  });
  const response = await adapter("https://github-native.invalid/functions/v1/gatelog-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-downtime-session": "browser-token-must-not-be-forwarded",
      "apikey": "browser-api-key-must-not-be-forwarded"
    },
    body: JSON.stringify({ action: "customer-arrival", customerName: "North Yard", vehicleReg: "AB12 CDE" })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, visitId: "visit-01" });
  assert.equal(broker.calls.polled, 2);
  assert.deepEqual(broker.calls.submitted[0], {
    payload: {
      service: "gatelog-api",
      action: "customer-arrival",
      args: { customerName: "North Yard", vehicleReg: "AB12 CDE" }
    },
    brokerPublicKey: "broker-public-key"
  });
});

test("broker fetch adapter delegates unrelated URLs to native fetch", async () => {
  const broker = makeBroker();
  const nativeCalls = [];
  const adapter = createGitHubBrokerFetchAdapter({
    brokerClient: broker,
    brokerPublicKey: "public-key",
    fetchImpl: async (input, init) => {
      nativeCalls.push({ input, init });
      return new Response("native", { status: 200 });
    }
  });
  const response = await adapter("https://api.github.com/user", { method: "GET" });
  assert.equal(await response.text(), "native");
  assert.equal(nativeCalls.length, 1);
  assert.equal(broker.calls.submitted.length, 0);
});

test("broker fetch adapter rejects unsupported methods and malformed action bodies", async () => {
  const broker = makeBroker();
  const adapter = createGitHubBrokerFetchAdapter({ brokerClient: broker, brokerPublicKey: "public-key" });
  const get = await adapter("https://github-native.invalid/functions/v1/central-bank", { method: "GET" });
  assert.equal(get.status, 405);
  const invalid = await adapter("https://github-native.invalid/functions/v1/central-bank", {
    method: "POST", body: JSON.stringify({ username: "operator" })
  });
  assert.equal(invalid.status, 400);
  assert.equal(broker.calls.submitted.length, 0);
});

test("broker fetch adapter returns encrypted broker failures as ordinary Edge errors", async () => {
  const broker = makeBroker({
    responses: [{
      pending: false,
      payload: {
        ok: false,
        requestId: "10fd938a-2107-4b8a-ade1-ba77bc542182",
        error: { code: "BROKER_PERMISSION_DENIED", message: "Traffic MANAGE is required.", status: 403 }
      }
    }]
  });
  const adapter = createGitHubBrokerFetchAdapter({ brokerClient: broker, brokerPublicKey: "public-key" });
  const response = await adapter("https://github-native.invalid/functions/v1/gatelog-api", {
    method: "POST", body: JSON.stringify({ action: "visit-delete", visitId: "visit-01" })
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Traffic MANAGE is required.",
    code: "BROKER_PERMISSION_DENIED"
  });
});

test("broker fetch adapter stops polling at the request deadline", async () => {
  const broker = makeBroker();
  let clock = 0;
  const adapter = createGitHubBrokerFetchAdapter({
    brokerClient: broker,
    brokerPublicKey: "public-key",
    now: () => clock,
    sleep: async ms => { clock += ms; },
    maxWaitMs: 1000,
    initialPollMs: 100,
    maxPollMs: 250
  });
  const response = await adapter("https://github-native.invalid/functions/v1/spectator-read", {
    method: "POST", body: JSON.stringify({ action: "snapshot" })
  });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, "BROKER_RESPONSE_TIMEOUT");
});
