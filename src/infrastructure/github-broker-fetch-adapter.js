const SERVICE_NAMES = new Set([
  "central-bank",
  "central-config-admin",
  "gatelog-api",
  "photo-evidence",
  "repair-maintenance-api",
  "spectator-read",
  "yard-hub-settings-api"
]);

function jsonResponse(body, status, ResponseImpl) {
  return new ResponseImpl(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-YARDHUB-Transport": "github-actions-broker"
    }
  });
}

/**
 * Converts the existing Supabase Edge Function fetch contract into encrypted
 * issue-comment broker requests. The browser never receives a Data App token,
 * service-role token or Central Bank session token.
 */
export function createGitHubBrokerFetchAdapter({
  brokerClient,
  brokerPublicKey,
  fetchImpl = globalThis.fetch,
  ResponseImpl = globalThis.Response,
  now = () => Date.now(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  maxWaitMs = 240_000,
  initialPollMs = 500,
  maxPollMs = 4_000
} = {}) {
  if (!brokerClient || typeof brokerClient.submitEncryptedRequest !== "function" ||
      typeof brokerClient.pollEncryptedResponse !== "function") {
    throw new TypeError("An authenticated GitHub broker client is required.");
  }
  if (typeof fetchImpl !== "function" || typeof ResponseImpl !== "function") {
    throw new TypeError("Native fetch and Response implementations are required.");
  }
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1000 ||
      !Number.isSafeInteger(initialPollMs) || initialPollMs < 50 ||
      !Number.isSafeInteger(maxPollMs) || maxPollMs < initialPollMs) {
    throw new TypeError("Broker polling limits are invalid.");
  }

  return async function githubBrokerFetch(input, init = {}) {
    let url;
    let method;
    let requestBody;
    try {
      url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      method = String(init.method || input?.method || "GET").toUpperCase();
      requestBody = init.body;
      if (requestBody === undefined && input instanceof Request) {
        requestBody = await input.clone().text();
      }
    } catch {
      return jsonResponse({ error: "Invalid broker request URL." }, 400, ResponseImpl);
    }

    const match = url.pathname.replace(/\/$/, "").match(/^\/functions\/v1\/([a-z0-9-]+)$/);
    if (!match || url.hostname !== "github-native.invalid") {
      return fetchImpl(input, init);
    }
    if (method === "OPTIONS") return new ResponseImpl(null, { status: 204 });
    if (method !== "POST") {
      return jsonResponse({ error: "YARDHUB broker Edge actions require POST." }, 405, ResponseImpl);
    }

    const service = match[1];
    if (!SERVICE_NAMES.has(service)) {
      return jsonResponse({ error: "Unknown YARDHUB service." }, 404, ResponseImpl);
    }

    let body;
    try {
      body = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
    } catch {
      return jsonResponse({ error: "Edge action body must be valid JSON." }, 400, ResponseImpl);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.action !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(body.action)) {
      return jsonResponse({ error: "Edge action body must contain a valid action." }, 400, ResponseImpl);
    }

    const args = { ...body };
    delete args.action;
    // Session and API-key headers are intentionally not copied into the
    // encrypted request. The Actions broker creates a short-lived service
    // session from the GitHub event identity and canonical YARD ROLE.
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete("authorization");
    headers.delete("apikey");
    headers.delete("x-downtime-session");

    let context;
    try {
      context = await brokerClient.submitEncryptedRequest({
        payload: { service, action: body.action, args },
        brokerPublicKey
      });
    } catch (error) {
      return jsonResponse({
        error: String(error?.message || "Could not submit the encrypted YARDHUB request.").slice(0, 240),
        code: error?.code || "BROKER_SUBMISSION_FAILED"
      }, error?.status === 401 ? 401 : 502, ResponseImpl);
    }

    const deadline = now() + maxWaitMs;
    let delay = initialPollMs;
    while (now() < deadline) {
      let polled;
      try {
        polled = await brokerClient.pollEncryptedResponse(context);
      } catch (error) {
        return jsonResponse({
          error: String(error?.message || "Could not retrieve the encrypted YARDHUB response.").slice(0, 240),
          code: error?.code || "BROKER_POLL_FAILED"
        }, error?.status === 401 ? 401 : 502, ResponseImpl);
      }
      if (polled && polled.pending === false) {
        const payload = polled.payload;
        if (!payload || typeof payload !== "object" || payload.requestId !== context.requestId) {
          return jsonResponse({ error: "The encrypted broker response did not match the pending request." }, 502, ResponseImpl);
        }
        if (payload.ok === false) {
          const failure = payload.error && typeof payload.error === "object" ? payload.error : {};
          return jsonResponse({
            error: String(failure.message || "YARDHUB rejected the request.").slice(0, 240),
            code: failure.code || "BROKER_ACTION_FAILED"
          }, Number.isInteger(failure.status) && failure.status >= 400 && failure.status <= 599 ? failure.status : 403, ResponseImpl);
        }
        const result = payload.result;
        if (!result || typeof result !== "object" || !Number.isInteger(result.status) ||
            result.status < 200 || result.status > 599 || result.body === undefined) {
          return jsonResponse({ error: "The broker returned an invalid Edge Function response." }, 502, ResponseImpl);
        }
        return jsonResponse(result.body, result.status, ResponseImpl);
      }
      await sleep(delay);
      delay = Math.min(maxPollMs, Math.ceil(delay * 1.5));
    }
    return jsonResponse({
      error: "YARDHUB did not return a response before the broker request deadline.",
      code: "BROKER_RESPONSE_TIMEOUT"
    }, 504, ResponseImpl);
  };
}
