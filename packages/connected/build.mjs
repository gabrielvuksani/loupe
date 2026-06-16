import { build } from "esbuild";
import { readFileSync } from "node:fs";

// Bundle the CLI into one self-contained dist/bin.js. The workspace engine is
// inlined (it ships as TypeScript source, so a published package cannot resolve
// it at runtime); every real npm dependency stays external and is resolved from
// node_modules at install time. Subpath imports need the /* form too.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const external = Object.keys(pkg.dependencies)
  .filter((d) => d !== "@goldeye/engine")
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
