import {
  clearGitHubConnection,
  createConnectedGitHubStore,
  createPrivateGitHubDataRepository,
  saveGitHubConnection
} from "../../src/infrastructure/github-connection.js";
import { ensureGitHubDatabaseReady } from "../../src/infrastructure/github-database-bootstrap.js";
import { installGitHubEdgeRuntime } from "./github-edge-runtime.js";

let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
globalThis.__YARDHUB_GITHUB_READY__ = ready;
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.__YARDHUB_NATIVE_FETCH__ = nativeFetch;
const earlyFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (/\/functions\/v1\//i.test(String(url))) {
    await ready;
    const activeFetch = globalThis.fetch;
    if (activeFetch !== earlyFetch) return activeFetch(input, init);
  }
  return nativeFetch(input, init);
};
globalThis.fetch = earlyFetch;

function status(message, isError = false) {
  const target = document.querySelector("[data-yardhub-github-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.state = isError ? "error" : "info";
}

function lockApplication(locked) {
  document.body.classList.toggle("yardhub-github-locked", locked);
  const overlay = document.getElementById("yardhub-github-connect-overlay");
  if (overlay) overlay.hidden = !locked;
}

async function activateRepository({ owner, repo, button, tokenInput }) {
  let runtime = null;
  try {
    status("Verifying private repository and initialising the YARDHUB data schema…");
    const store = await createConnectedGitHubStore({
      storage: globalThis.localStorage,
      systemId: "DOWNTIMEUI-GITHUB",
      fetchImpl: globalThis.__YARDHUB_NATIVE_FETCH__ || globalThis.fetch
    });
    const authority = await store.ensureAuthority();
    const beforeRestore = await store.readDatabase();
    let restoreResult = null;
    if (beforeRestore.revision === 0 && Object.keys(beforeRestore.tables).length === 0 &&
        typeof store.inspectYardHubPrimaryBackup === "function") {
      const primaryBackup = await store.inspectYardHubPrimaryBackup();
      if (primaryBackup) {
        const restore = globalThis.confirm(
          "A YARDHUB primary backup manifest was found (" + primaryBackup.tableCount +
          " tables, " + primaryBackup.storageObjectCount + " files, exported " +
          primaryBackup.exportedAt + ").\n\nRestore this backup into the private GitHub database now?\n\nChoose Cancel to install a clean empty YARDHUB instead."
        );
        if (restore) {
          restoreResult = await store.restoreYardHubPrimaryBackup({ expectedRevision: beforeRestore.revision });
        }
      }
    }
    const database = await ensureGitHubDatabaseReady({ store });
    runtime = await installGitHubEdgeRuntime({
      store, actorId: "YARDHUB-GITHUB-RUNTIME",
      fetchImpl: globalThis.__YARDHUB_NATIVE_FETCH__ || globalThis.fetch
    });
    const verifiedAuthority = await store.readAuthority();
    if (verifiedAuthority.primarySystemId !== "YARDHUB-PRIMARY" ||
        verifiedAuthority.status !== "ACTIVE" ||
        verifiedAuthority.epoch !== 1) {
      throw new Error("Initial authority check failed. YARDHUB must remain the primary system during installation.");
    }
    globalThis.__YARDHUB_GITHUB_STORE__ = store;
    globalThis.__YARDHUB_GITHUB_RUNTIME__ = runtime;
    globalThis.__YARDHUB_GITHUB_DATABASE__ = database;
    globalThis.__YARDHUB_GITHUB_CONNECTED__ = true;
    const bootstrapInput = document.getElementById("setupCode");
    if (bootstrapInput) bootstrapInput.value = database.bootstrapCode || "";
    status("Private repository ready · " + owner + "/" + repo +
      " · " + database.tableCount + " tables" +
      (restoreResult ? " · restored verified primary backup from " + restoreResult.exportedAt + " · " + restoreResult.storageObjectCount + " files" : "") +
      " · primary: " + verifiedAuthority.primarySystemId);
    lockApplication(false);
    resolveReady({ store, runtime, authority, database });
    globalThis.dispatchEvent(new CustomEvent("yardhub:github-connected", {
      detail: { authority: verifiedAuthority, database }
    }));
    return true;
  } catch (error) {
    await runtime?.dispose?.();
    clearGitHubConnection();
    status(error?.message || "GitHub initialisation failed. Check the private repository and token.", true);
    button.disabled = false;
    tokenInput.focus();
    return false;
  }
}

async function connectExisting(form) {
  const owner = form.querySelector("[name=owner]").value.trim();
  const repo = form.querySelector("[name=repo]").value.trim();
  const branch = form.querySelector("[name=branch]").value.trim() || "main";
  const tokenInput = form.querySelector("[name=token]");
  const token = tokenInput.value.trim();
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    saveGitHubConnection({ owner, repo, branch, token });
    tokenInput.value = "";
    await activateRepository({ owner, repo, button, tokenInput });
  } catch (error) {
    clearGitHubConnection();
    status(error?.message || "GitHub connection failed. Check the private repository and token.", true);
    button.disabled = false;
    tokenInput.focus();
  }
}

async function createPrivateRepository(form) {
  const owner = form.querySelector("[name=owner]").value.trim();
  const repo = form.querySelector("[name=repo]").value.trim();
  const tokenInput = form.querySelector("[name=token]");
  const token = tokenInput.value.trim();
  const button = form.querySelector("[data-create-private]");
  button.disabled = true;
  try {
    const created = await createPrivateGitHubDataRepository({
      owner, repo, token,
      fetchImpl: globalThis.__YARDHUB_NATIVE_FETCH__ || globalThis.fetch
    });
    tokenInput.value = "";
    const branchInput = form.querySelector("[name=branch]");
    if (branchInput) branchInput.value = created.defaultBranch;
    button.hidden = true;
    status("Created private repository · " + created.fullName +
      ". Now enter a separate fine-grained token limited to this repository (Contents read/write, Metadata read), then choose CONNECT & INITIALISE.");
    tokenInput.focus();
  } catch (error) {
    status(error?.message || "Private repository creation failed. Check the token permissions.", true);
    button.disabled = false;
    tokenInput.focus();
  }
}

function initialise() {
  const form = document.getElementById("yardhub-github-connect-form");
  if (!form) return;
  lockApplication(true);
  form.addEventListener("submit", event => {
    event.preventDefault();
    void connectExisting(form);
  });
  form.querySelector("[data-create-private]")?.addEventListener("click", () => {
    void createPrivateRepository(form);
  });
  const disconnect = document.querySelector("[data-yardhub-github-disconnect]");
  disconnect?.addEventListener("click", () => {
    clearGitHubConnection();
    globalThis.__YARDHUB_GITHUB_RUNTIME__?.dispose?.();
    globalThis.location.reload();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
}
