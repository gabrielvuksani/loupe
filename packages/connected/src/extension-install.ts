import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The pre-built extension is shipped next to the bundled CLI at dist/extension,
// so `loupe-cli extension` can hand it to the user with no repo clone or build.
export function bundledExtensionDir(): string {
  return fileURLToPath(new URL("./extension", import.meta.url));
}

export interface InstallResult {
  ok: boolean;
  dir: string;
  message: string;
}

// Copy the bundled extension into targetDir. Pure over the filesystem: the
// source defaults to the shipped bundle but is injectable for tests.
export function installExtension(
  targetDir: string,
  sourceDir: string = bundledExtensionDir(),
): InstallResult {
  const dir = resolve(targetDir);
  if (!existsSync(sourceDir)) {
    return {
      ok: false,
      dir,
      message: `Bundled extension not found at ${sourceDir}. Build it from source instead: pnpm --filter @loupe/extension build.`,
    };
  }
  cpSync(sourceDir, dir, { recursive: true });
  return { ok: true, dir, message: `Loupe extension written to ${dir}` };
}
