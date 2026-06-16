import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installExtension } from "../src/extension-install";

describe("installExtension", () => {
  it("copies the bundled extension tree to the target directory", () => {
    const src = mkdtempSync(join(tmpdir(), "loupe-ext-src-"));
    mkdirSync(join(src, "icon"), { recursive: true });
    writeFileSync(join(src, "manifest.json"), '{"name":"Loupe"}');
    writeFileSync(join(src, "icon", "16.png"), "x");
    const dest = join(mkdtempSync(join(tmpdir(), "loupe-ext-dst-")), "loupe-extension");

    const r = installExtension(dest, src);
    expect(r.ok).toBe(true);
    expect(r.dir).toBe(dest);
    expect(existsSync(join(dest, "manifest.json"))).toBe(true);
    expect(existsSync(join(dest, "icon", "16.png"))).toBe(true);
  });

  it("fails with a helpful message when the bundled extension is missing", () => {
    const r = installExtension(join(tmpdir(), "loupe-x"), join(tmpdir(), "nope-missing-9d3f1a"));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found|build/i);
  });
});
