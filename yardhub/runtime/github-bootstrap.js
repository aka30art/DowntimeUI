import { createGitHubAppBrokerClient } from "../../src/infrastructure/github-app-broker-client.js";
import { createGitHubBrokerFetchAdapter } from "../../src/infrastructure/github-broker-fetch-adapter.js";

const config = window.YARDHUB_GITHUB_BROKER_CONFIG || {};
const nativeFetch = window.fetch.bind(window);
const functionBase = "https://github-native.invalid/functions/v1/";

function setStatus(message, isError = false) {
  const target = document.getElementById("authMsg") || document.getElementById("githubBrokerStatus");
  if (target) {
    target.textContent = message;
    target.dataset.state = isError ? "error" : "info";
  }
}

function validConfig() {
  return typeof config.clientId === "string" && config.clientId.trim().length > 0 &&
    typeof config.clientSecret === "string" && config.clientSecret.trim().length > 0 &&
    Number.isSafeInteger(Number(config.repositoryId)) && Number(config.repositoryId) > 0 &&
    typeof config.owner === "string" && config.owner.trim().length > 0 &&
    typeof config.repository === "string" && config.repository.trim().length > 0 &&
    typeof config.brokerPublicKey === "string" && config.brokerPublicKey.trim().length > 0;
}

function configureEndpoints() {
  window.DOWNTIME_CENTRAL_API = functionBase + "central-bank";
  window.CENTRAL_CONFIG_ADMIN_API = functionBase + "central-config-admin";
  window.GATELOG_API = functionBase + "gatelog-api";
  window.PHOTO_EVIDENCE_API = functionBase + "photo-evidence";
  window.REPAIR_MAINTENANCE_API = functionBase + "repair-maintenance-api";
  window.SPECTATOR_READ_API = functionBase + "spectator-read";
  window.YARD_HUB_SETTINGS_API = functionBase + "yard-hub-settings-api";
  // GitHub-only runtime must not fall back to Supabase anonymous auth.
  window.SUPABASE_URL = "";
  window.SUPABASE_ANON_KEY = "";
}

async function initialiseBroker() {
  if (!validConfig()) {
    window.YARDHUB_GITHUB_BROKER_CONFIGURED = false;
    const button = document.getElementById("unlockBtn");
    if (button) button.disabled = true;
    setStatus("GitHub broker is not configured yet. Direct data-repository tokens are disabled. Configure the public Inbox App and private broker repository settings to continue.", true);
    return false;
  }

  const redirectUri = String(config.redirectUri || (window.location.origin + window.location.pathname));
  const brokerClient = createGitHubAppBrokerClient({
    clientId: config.clientId.trim(),
    repositoryId: Number(config.repositoryId),
    owner: config.owner.trim(),
    repository: config.repository.trim(),
    issueNumber: null,
    fetchImpl: nativeFetch,
    storage: window.sessionStorage
  });
  const brokerFetch = createGitHubBrokerFetchAdapter({
    brokerClient,
    brokerPublicKey: config.brokerPublicKey.trim(),
    fetchImpl: nativeFetch
  });

  window.YARDHUB_GITHUB_BROKER_CLIENT = brokerClient;
  window.YARDHUB_GITHUB_BROKER_CONFIGURED = true;
  window.YARDHUB_GITHUB_BROKER_CONFIG = config;
  window.fetch = brokerFetch;
  configureEndpoints();
  if (window.DowntimeCentral?.configureBroker) {
    window.DowntimeCentral.configureBroker(brokerClient, { ...config, redirectUri });
  } else {
    throw new Error("Central Bank broker client did not initialise before GitHub bootstrap.");
  }

  const callback = new URL(window.location.href);
  if (callback.searchParams.has("error")) {
    const error = callback.searchParams.get("error_description") || callback.searchParams.get("error");
    setStatus("GitHub sign-in was not completed: " + String(error).slice(0, 180), true);
    window.history.replaceState({}, document.title, redirectUri);
    return true;
  }
  if (callback.searchParams.has("code") || callback.searchParams.has("state")) {
    setStatus("Verifying GitHub identity and assigned YARDHUB inbox…");
    try {
      await window.DowntimeCentral.completeBrokerLogin(window.location.href);
      window.history.replaceState({}, document.title, redirectUri);
      setStatus("GitHub identity verified. Loading YARDHUB…");
    } catch (error) {
      window.history.replaceState({}, document.title, redirectUri);
      setStatus(String(error?.message || "GitHub broker sign-in failed.").slice(0, 240), true);
    }
  }
  return true;
}

window.YARDHUB_GITHUB_BROKER_READY = initialiseBroker().catch(error => {
  window.YARDHUB_GITHUB_BROKER_CONFIGURED = false;
  setStatus(String(error?.message || "GitHub broker initialisation failed.").slice(0, 240), true);
  const button = document.getElementById("unlockBtn");
  if (button) button.disabled = true;
  return false;
});
