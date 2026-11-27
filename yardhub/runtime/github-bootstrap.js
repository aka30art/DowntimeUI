import {
  clearGitHubConnection,
  createConnectedGitHubStore,
  saveGitHubConnection
} from "../../src/infrastructure/github-connection.js";
import { installGitHubEdgeRuntime } from "./github-edge-runtime.js";

let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
globalThis.__YARDHUB_GITHUB_READY__ = ready;

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

async function connect(form) {
  const owner = form.querySelector("[name=owner]").value.trim();
  const repo = form.querySelector("[name=repo]").value.trim();
  const branch = form.querySelector("[name=branch]").value.trim() || "main";
  const tokenInput = form.querySelector("[name=token]");
  const token = tokenInput.value.trim();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  status("Verifying the private GitHub repository and opening the data branch…");

  try {
    saveGitHubConnection({ owner, repo, branch, token });
    tokenInput.value = "";
    const store = await createConnectedGitHubStore({
      storage: globalThis.localStorage,
      systemId: "DOWNTIMEUI-GITHUB",
      fetchImpl: globalThis.fetch
    });
    if (typeof store.ensureAuthority === "function") await store.ensureAuthority();
    const runtime = await installGitHubEdgeRuntime({ store, actorId: "YARDHUB-GITHUB-RUNTIME" });
    const authority = await store.readAuthority();
    globalThis.__YARDHUB_GITHUB_STORE__ = store;
    globalThis.__YARDHUB_GITHUB_RUNTIME__ = runtime;
    globalThis.__YARDHUB_GITHUB_CONNECTED__ = true;
    status("Connected · " + owner + "/" + repo + " · primary: " + authority.primarySystemId);
    lockApplication(false);
    resolveReady({ store, runtime, authority });
  } catch (error) {
    clearGitHubConnection();
    status(error?.message || "GitHub connection failed. Check the private repository and token.", true);
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
    void connect(form);
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
