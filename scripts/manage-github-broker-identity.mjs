import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createGitHubDataStore } from "../src/infrastructure/github-data-store.js";
import { createGitHubBrokerAuthority } from "../src/infrastructure/github-broker-authority.js";
import { createDataRepositoryInstallationToken, verifyPrivateRepository } from "./run-github-actions-broker.mjs";

function requiredEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error("Required broker identity-admin environment variable is missing: " + name);
  return value;
}

function requiredId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(label + " must be a positive integer.");
  return number;
}

function requiredGitHubUserId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,20}$/.test(id)) throw new TypeError("GitHub user ID must be a numeric string.");
  return id;
}

function requiredReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 5 || reason.length > 300) throw new TypeError("An identity administration reason between 5 and 300 characters is required.");
  return reason;
}

/**
 * Dedicated private broker-repository workflow_dispatch entry point.
 * GitHub's authenticated workflow actor is resolved through immutable DEV;
 * the browser and workflow inputs cannot assert their own privilege.
 */
export async function runGitHubBrokerIdentityAdmin({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readEvent = path => readFile(path, "utf8"),
  cryptoProvider = webcrypto,
  now = () => new Date(),
  createStore = createGitHubDataStore,
  mintDataToken = createDataRepositoryInstallationToken
} = {}) {
  const eventPath = requiredEnv(env, "GITHUB_EVENT_PATH");
  const event = JSON.parse(await readEvent(eventPath));
  if (requiredEnv(env, "GITHUB_EVENT_NAME") !== "workflow_dispatch") {
    throw new Error("Broker identity administration accepts workflow_dispatch only.");
  }
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const [brokerOwner, brokerRepository] = repository.split("/");
  if (!brokerOwner || !brokerRepository) throw new Error("GITHUB_REPOSITORY must be owner/repository.");
  const brokerRepositoryId = requiredId(requiredEnv(env, "YARDHUB_BROKER_REPOSITORY_ID"), "Broker repository ID");
  if (Number(event.repository?.id) !== brokerRepositoryId ||
      String(event.repository?.full_name || "").toLowerCase() !== repository.toLowerCase() ||
      event.repository?.private !== true) {
    throw new Error("Identity administration must run inside the configured private broker repository.");
  }
  const defaultBranch = String(event.repository?.default_branch || "");
  if (!defaultBranch || String(env.GITHUB_REF || "") !== "refs/heads/" + defaultBranch) {
    throw new Error("Identity administration must run from the broker repository default branch.");
  }
  const actorId = requiredId(requiredEnv(env, "GITHUB_ACTOR_ID"), "Authenticated GitHub actor ID");
  if (event.sender?.id != null && Number(event.sender.id) !== actorId) {
    throw new Error("Workflow actor does not match the authenticated GitHub event sender.");
  }
  const inputs = event.inputs || {};
  const action = String(inputs.action || "").trim().toLowerCase();
  if (!["link", "revoke"].includes(action)) throw new TypeError("Identity action must be link or revoke.");

  const dataOwner = requiredEnv(env, "YARDHUB_DATA_OWNER");
  const dataRepository = requiredEnv(env, "YARDHUB_DATA_REPOSITORY");
  const dataRepositoryId = requiredId(requiredEnv(env, "YARDHUB_DATA_REPOSITORY_ID"), "Data repository ID");
  const dataFullName = (dataOwner + "/" + dataRepository).toLowerCase();
  const brokerFullName = repository.toLowerCase();
  const forbiddenRepositories = new Set([
    "aka30art/downtime",
    "aka30art/dop-website",
    "aka30art/downtimeui"
  ]);
  if (forbiddenRepositories.has(dataFullName) || forbiddenRepositories.has(brokerFullName) ||
      dataRepositoryId === brokerRepositoryId || dataFullName === brokerFullName) {
    throw new Error("Broker and data repositories must be distinct dedicated private repositories.");
  }
  const dataBranch = String(env.YARDHUB_DATA_BRANCH || "data/yardhub").trim();
  if (dataBranch !== "data/yardhub") {
    throw new Error("The GitHub-native operational store must use the dedicated data/yardhub branch.");
  }
  const dataAppId = requiredEnv(env, "YARDHUB_DATA_APP_ID");
  const dataInstallationId = requiredEnv(env, "YARDHUB_DATA_APP_INSTALLATION_ID");
  const dataAppPrivateKey = requiredEnv(env, "YARDHUB_DATA_APP_PRIVATE_KEY");
  const workflowToken = requiredEnv(env, "GITHUB_TOKEN");
  const dataToken = await mintDataToken({
    appId: dataAppId,
    appPrivateKey: dataAppPrivateKey,
    installationId: dataInstallationId,
    repositoryId: dataRepositoryId,
    fetchImpl,
    now
  });
  await verifyPrivateRepository({
    owner: brokerOwner,
    repository: brokerRepository,
    token: workflowToken,
    expectedId: brokerRepositoryId,
    fetchImpl
  });
  await verifyPrivateRepository({
    owner: dataOwner,
    repository: dataRepository,
    token: dataToken,
    expectedId: dataRepositoryId,
    fetchImpl
  });
  const store = createStore({
    owner: dataOwner,
    repo: dataRepository,
    branch: dataBranch,
    token: dataToken,
    fetchImpl,
    now
  });
  const bootstrapGitHubUserId = String(env.YARDHUB_BROKER_BOOTSTRAP_GITHUB_USER_ID || "").trim() || null;
  const bootstrapIssueIdRaw = String(env.YARDHUB_BROKER_BOOTSTRAP_ISSUE_ID || "").trim();
  const bootstrapIssueId = bootstrapIssueIdRaw ? requiredId(bootstrapIssueIdRaw, "Bootstrap DEV issue ID") : null;
  if (Boolean(bootstrapGitHubUserId) !== Boolean(bootstrapIssueId)) {
    throw new TypeError("Bootstrap DEV GitHub ID and bootstrap issue ID must be configured together.");
  }
  const authority = createGitHubBrokerAuthority({
    store,
    brokerRepositoryId,
    bootstrapGitHubUserId,
    bootstrapIssueId,
    now
  });
  const principal = await authority.resolvePrincipal(String(actorId));
  if (!principal || principal.rootsClass !== "DEV") {
    throw new Error("Only the authenticated immutable DEV principal may administer broker identities.");
  }

  const reason = requiredReason(inputs.reason);
  if (action === "link") {
    const githubUserId = requiredGitHubUserId(inputs.github_user_id);
    const brokerIssueNumber = requiredId(inputs.broker_issue_number, "Target broker inbox issue number");
    const brokerIssueId = requiredId(inputs.broker_issue_id, "Target broker inbox issue ID");
    const userId = String(inputs.user_id || "").trim();
    const staffId = String(inputs.staff_id || "").trim();
    const issueResponse = await fetchImpl(
      "https://api.github.com/repos/" + encodeURIComponent(brokerOwner) + "/" +
      encodeURIComponent(brokerRepository) + "/issues/" + brokerIssueNumber,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + workflowToken,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );
    const issue = await issueResponse.json();
    if (!issueResponse.ok || Number(issue.id) !== brokerIssueId ||
        issue.pull_request || String(issue.state).toLowerCase() !== "open" ||
        !Array.isArray(issue.assignees) || issue.assignees.length !== 1 ||
        String(issue.assignees[0]?.id) !== githubUserId) {
      throw new Error("The target inbox issue must be open, non-PR and assigned to the target GitHub account.");
    }
    await authority.linkIdentity({
      actorPrincipal: principal,
      githubUserId,
      userId,
      staffId,
      issueId: brokerIssueId,
      reason
    });
  } else {
    const githubUserId = requiredGitHubUserId(inputs.github_user_id);
    await authority.revokeIdentity({
      actorPrincipal: principal,
      githubUserId,
      reason
    });
  }
  return Object.freeze({ accepted: true, action });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGitHubBrokerIdentityAdmin().then(result => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch(() => {
    process.stderr.write("GitHub broker identity administration failed. No identity change is confirmed.\n");
    process.exitCode = 1;
  });
}
