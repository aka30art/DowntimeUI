import { readFile } from "node:fs/promises";
import { createPrivateKey, createSign, webcrypto } from "node:crypto";
import { createGitHubDataStore } from "../src/infrastructure/github-data-store.js";
import { installGitHubEdgeRuntime } from "../yardhub/runtime/github-edge-runtime.js";
import { createGitHubYardHubBroker } from "../src/infrastructure/github-actions-broker-runtime.js";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function requiredEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error("Required broker environment variable is missing: " + name);
  return value;
}

function createGitHubAppJwt({ appId, privateKey, now = () => new Date() }) {
  const issuedAt = Math.floor(now().getTime() / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }));
  const unsigned = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return unsigned + "." + signer.sign(privateKey, "base64url");
}

async function createDataRepositoryInstallationToken({
  appId, appPrivateKey, installationId, repositoryId, fetchImpl = globalThis.fetch, now = () => new Date()
}) {
  const repositoryNumericId = Number(repositoryId);
  if (!Number.isSafeInteger(repositoryNumericId) || repositoryNumericId <= 0) {
    throw new TypeError("YARDHUB_DATA_REPOSITORY_ID must be a positive numeric repository ID.");
  }
  const jwt = createGitHubAppJwt({
    appId,
    privateKey: createPrivateKey(String(appPrivateKey).replace(/\\n/g, "\n")),
    now
  });
  const response = await fetchImpl(
    "https://api.github.com/app/installations/" + encodeURIComponent(installationId) + "/access_tokens",
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + jwt,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repository_ids: [repositoryNumericId],
        permissions: { contents: "write", metadata: "read" }
      })
    }
  );
  const result = await response.json();
  if (!response.ok || typeof result.token !== "string") {
    throw new Error("The Data App could not mint a repository-restricted installation token.");
  }
  return result.token;
}

function importBrokerPrivateKey(pem, cryptoProvider) {
  const normalized = String(pem).replace(/\\n/g, "\n");
  const base64 = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return cryptoProvider.subtle.importKey(
    "pkcs8",
    Buffer.from(base64, "base64"),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
}

/**
 * Entry point for a dedicated private broker repository's issue_comment
 * workflow. The workflow token can comment only in the broker repository;
 * the Data App installation token is restricted to one private data repository.
 */
export async function runGitHubActionsBroker({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readEvent = path => readFile(path, "utf8"),
  cryptoProvider = webcrypto,
  now = () => new Date()
} = {}) {
  const eventPath = requiredEnv(env, "GITHUB_EVENT_PATH");
  const event = JSON.parse(await readEvent(eventPath));
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const [brokerOwner, brokerRepository] = repository.split("/");
  if (!brokerOwner || !brokerRepository) throw new Error("GITHUB_REPOSITORY must be owner/repository.");
  const brokerRepositoryId = Number(requiredEnv(env, "YARDHUB_BROKER_REPOSITORY_ID"));
  if (!Number.isSafeInteger(brokerRepositoryId) || brokerRepositoryId <= 0) {
    throw new TypeError("YARDHUB_BROKER_REPOSITORY_ID must be a positive numeric repository ID.");
  }

  const dataOwner = requiredEnv(env, "YARDHUB_DATA_OWNER");
  const dataRepository = requiredEnv(env, "YARDHUB_DATA_REPOSITORY");
  const dataRepositoryId = requiredEnv(env, "YARDHUB_DATA_REPOSITORY_ID");
  const dataAppId = requiredEnv(env, "YARDHUB_DATA_APP_ID");
  const dataInstallationId = requiredEnv(env, "YARDHUB_DATA_APP_INSTALLATION_ID");
  const dataAppPrivateKey = requiredEnv(env, "YARDHUB_DATA_APP_PRIVATE_KEY");
  const brokerPrivateKeyPem = requiredEnv(env, "YARDHUB_BROKER_ECDH_PRIVATE_KEY");
  const workflowToken = requiredEnv(env, "GITHUB_TOKEN");

  const dataToken = await createDataRepositoryInstallationToken({
    appId: dataAppId,
    appPrivateKey: dataAppPrivateKey,
    installationId: dataInstallationId,
    repositoryId: dataRepositoryId,
    fetchImpl,
    now
  });
  const store = createGitHubDataStore({
    owner: dataOwner,
    repo: dataRepository,
    branch: env.YARDHUB_DATA_BRANCH || "main",
    token: dataToken,
    fetchImpl,
    now
  });
  const brokerPrivateKey = await importBrokerPrivateKey(brokerPrivateKeyPem, cryptoProvider);
  const runtime = await installGitHubEdgeRuntime({ store });
  try {
    const broker = createGitHubYardHubBroker({
      store,
      handlers: runtime.handlers,
      expectedRepositoryId: brokerRepositoryId,
      brokerPrivateKey,
      githubToken: workflowToken,
      brokerOwner,
      brokerRepository,
      cryptoProvider,
      fetchImpl,
      now,
      origin: env.YARDHUB_EDGE_ORIGIN || "https://aka30art.github.io"
    });
    return await broker.handleIssueComment(event);
  } finally {
    await runtime.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGitHubActionsBroker().then(result => {
    process.stdout.write(JSON.stringify({
      accepted: result?.accepted === true,
      replayed: result?.replayed === true,
      pending: result?.pending === true
    }) + "\n");
  }).catch(() => {
    // Never print event payloads, credentials, session tokens or decrypted data.
    process.stderr.write("GitHub YARDHUB broker request failed. Inspect the redacted workflow status and broker audit ledger.\n");
    process.exitCode = 1;
  });
}
