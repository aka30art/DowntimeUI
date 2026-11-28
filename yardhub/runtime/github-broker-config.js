/*
 * Public browser configuration for the GitHub Actions broker.
 * The client secret below is a public OAuth client identifier, not a secret.
 * Never place the Data App private key, installation token, broker ECDH
 * private key, or any Central Bank session token in this file.
 */
window.YARDHUB_GITHUB_BROKER_CONFIG = Object.freeze({
  clientId: "",
  clientSecret: "",
  repositoryId: 0,
  owner: "",
  repository: "",
  brokerPublicKey: "",
  redirectUri: "https://aka30art.github.io/DowntimeUI/",
  inboxLabel: "yardhub-inbox"
});
