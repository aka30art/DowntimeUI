import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const functions = [
  ["central-bank", "yardhub/reference/supabase/functions/central-bank/index.ts"],
  ["central-config-admin", "yardhub/reference/supabase/functions/central-config-admin/index.ts"],
  ["gatelog-api", "yardhub/reference/supabase/functions/gatelog-api/index.ts"],
  ["photo-evidence", "yardhub/reference/supabase/functions/photo-evidence/index.ts"],
  ["repair-maintenance-api", "yardhub/reference/supabase/functions/repair-maintenance-api/index.ts"],
  ["spectator-read", "yardhub/reference/supabase/functions/spectator-read/index.ts"],
  ["yard-hub-settings-api", "yardhub/reference/supabase/functions/yard-hub-settings-api/index.ts"]
];

const supabaseShim = resolve(root, "src/infrastructure/supabase-client-shim.js");

const plugin = {
  name: "yardhub-github-runtime-aliases",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^jsr:/ }, () => ({ path: "ignored-edge-runtime-types", namespace: "ignored" }));
    buildApi.onLoad({ filter: /.*/, namespace: "ignored" }, () => ({ contents: "export {};", loader: "js" }));

    buildApi.onResolve({ filter: /^(https:\/\/esm\.sh\/@supabase\/supabase-js|npm:@supabase\/supabase-js)/ }, () => ({ path: supabaseShim }));
    buildApi.onResolve({ filter: /^https:\/\/esm\.sh\/pdf-lib@1\.17\.1$/ }, async (args) =>
      buildApi.resolve("pdf-lib", { resolveDir: root, kind: "import-statement", importer: args.importer })
    );

    buildApi.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");
      contents = contents.replace(
        /const allowedOrigin\s*=\s*["']https:\/\/aka30art\.github\.io["']/g,
        'const allowedOrigin = globalThis.location?.origin || "https://aka30art.github.io"'
      );
      return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
    });
  }
};

await mkdir(resolve(root, "yardhub/runtime/functions"), { recursive: true });\n\nfor (const [name, entryPoint] of functions) {
  await build({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    outfile: resolve(root, "yardhub/runtime/functions/" + name + ".js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    plugins: [plugin]
  });
  process.stdout.write("Built GitHub-native YARDHUB service: " + name + "\n");
}
