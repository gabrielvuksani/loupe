import { build } from "esbuild";
import { readFileSync, cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Bundle the CLI into one self-contained dist/bin.js. The workspace engine is
// inlined (it ships as TypeScript source, so a published package cannot resolve
// it at runtime); every real npm dependency stays external and is resolved from
// node_modules at install time. Subpath imports need the /* form too.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const external = Object.keys(pkg.dependencies)
  .filter((d) => d !== "@loupe/engine")
  .flatMap((d) => [d, `${d}/*`]);

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/bin.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  external,
  logLevel: "info",
});

// Bundle the built Lens next to the CLI so `loupe-cli extension` can hand it to
// the user with no repo clone. Build the workspace extension, then copy its MV3
// output into dist/extension (shipped via the package's `files` allowlist).
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const extSrc = fileURLToPath(new URL("../extension/.output/chrome-mv3", import.meta.url));
const extDest = fileURLToPath(new URL("./dist/extension", import.meta.url));
execFileSync("pnpm", ["--filter", "@loupe/extension", "build"], { cwd: repoRoot, stdio: "inherit" });
rmSync(extDest, { recursive: true, force: true });
cpSync(extSrc, extDest, { recursive: true });
console.log(`bundled extension -> dist/extension`);
