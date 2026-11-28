export function createClient() {
  const runtime = globalThis.__YARDHUB_GITHUB_COMPAT__;
  if (!runtime || typeof runtime.createClient !== "function") {
    throw new Error("GitHub-native YARDHUB services have not been initialised.");
  }
  return runtime.createClient();
}
