const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function mutateWithRetry(store, { actorId, operationId, mutate, maxAttempts = 6 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await store.readDatabase();
    try {
      return await store.transactDatabase({
        expectedRevision: snapshot.revision,
        actorId,
        operationId: operationId + "-" + attempt,
        mutate
      });
    } catch (error) {
      if (error?.status !== 409 || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error("The GitHub session transaction could not be committed.");
}

/**
 * Creates a short-lived Central Bank-compatible session for one trusted
 * broker action. Only the SHA-256 token hash is persisted. The returned
 * disposer revokes the session after the handler completes; expiry is the
 * fallback if the broker process terminates unexpectedly.
 */
export async function createGitHubCentralServiceSession({
  store,
  principal,
  requestId,
  cryptoProvider = globalThis.crypto,
  now = () => new Date(),
  ttlMs = 2 * 60 * 1000
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A private GitHub data store is required.");
  }
  const immutableDevRoot = principal?.rootsClass === "DEV" &&
    String(principal?.username || "").trim().toUpperCase() === "DEV";
  if (typeof principal?.userId !== "string" || !UUID_PATTERN.test(principal.userId) ||
      typeof principal?.username !== "string" || !principal.username.trim() ||
      typeof principal?.tier !== "string" || !principal.tier.trim() ||
      (principal.staffId && (typeof principal.staffId !== "string" || !UUID_PATTERN.test(principal.staffId))) ||
      (!principal.staffId && !immutableDevRoot) ||
      principal.enabled !== true || principal.status !== "ACTIVE") {
    throw new Error("An active canonical USER/STAFF identity with a valid tier, or immutable DEV root, is required.");
  }
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new TypeError("A valid broker request ID is required.");
  }
  if (!cryptoProvider?.getRandomValues || !cryptoProvider?.subtle?.digest ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 5 * 60 * 1000) {
    throw new TypeError("Secure random, SHA-256 and a bounded session lifetime are required.");
  }

  const tokenBytes = cryptoProvider.getRandomValues(new Uint8Array(32));
  const token = toHex(tokenBytes);
  const tokenHash = toHex(new Uint8Array(await cryptoProvider.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )));
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  const row = {
    token_hash: tokenHash,
    username: principal.username,
    tier: principal.tier,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString()
  };

  await mutateWithRetry(store, {
    actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
    operationId: "broker-session-create-" + requestId,
    mutate: tables => {
      const sessions = Array.isArray(tables.downtime_central_sessions)
        ? tables.downtime_central_sessions
        : [];
      if (sessions.some(session => session.token_hash === tokenHash)) {
        throw new Error("A duplicate service-session token hash was generated.");
      }
      tables.downtime_central_sessions = [...sessions, row];
    }
  });

  let disposed = false;
  return Object.freeze({
    token,
    expiresAt: expiresAt.toISOString(),
    async dispose() {
      if (disposed) return;
      await mutateWithRetry(store, {
        actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
        operationId: "broker-session-revoke-" + requestId,
        mutate: tables => {
          const sessions = Array.isArray(tables.downtime_central_sessions)
            ? tables.downtime_central_sessions
            : [];
          tables.downtime_central_sessions = sessions.filter(session => session.token_hash !== tokenHash);
        }
      });
      disposed = true;
    }
  });
}
