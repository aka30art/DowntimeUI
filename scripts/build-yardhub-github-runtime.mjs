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
      if (args.path.endsWith("/central-bank/index.ts")) {
        const originalBootstrapPattern = /const salt=cryptoHex\\(crypto\\.getRandomValues\\(new Uint8Array\\(16\\)\\)\\);\\s*bank\\.users=\\[\\{username,displayName:username,tier:"OWNER",enabled:true,pinSalt:salt,pinHash:await hashPin\\(pin,salt\\)\\}\\];/;
        const githubBootstrap = [
          'const {data:bootstrapIdentity,error:bootstrapIdentityError}=await db.from("downtime_roots_bootstrap").select("user_id").eq("singleton",true).maybeSingle();',
          '   if(bootstrapIdentityError||!bootstrapIdentity?.user_id)return json({error:"Immutable DEV bootstrap identity is unavailable"},503);',
          '   const salt=cryptoHex(crypto.getRandomValues(new Uint8Array(16)));',
          '   bank.users=[{userId:bootstrapIdentity.user_id,username,displayName:username,tier:"OWNER",enabled:true,pinSalt:salt,pinHash:await hashPin(pin,salt)}];'
        ].join("\\n");
        if (!originalBootstrapPattern.test(contents)) {
          throw new Error("Central Bank bootstrap source contract changed; cannot bind DEV to immutable ROOTS identity.");
        }
        contents = contents.replace(originalBootstrapPattern, githubBootstrap);
      }
      return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
    });
  }
};

await mkdir(resolve(root, "yardhub/runtime/functions"), { recursive: true });

for (const [name, entryPoint] of functions) {
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
