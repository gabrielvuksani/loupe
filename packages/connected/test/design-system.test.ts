import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDesignSystem } from "../src/design-system";

const here = dirname(fileURLToPath(import.meta.url));
const systemApp = join(here, "fixtures", "system-app");

describe("loadDesignSystem", () => {
  it("reads loupe.tokens.json from the project root", () => {
    const sys = loadDesignSystem(systemApp);
    expect(sys).not.toBeNull();
    expect(sys?.fontSizes).toContain(16);
    expect(sys?.colors).toContain("#2563eb");
    expect(sys?.spacing).toContain(8);
    expect(sys?.fontFamilies).toContain("Inter");
  });

  it("returns null when no tokens file is present", () => {
    expect(loadDesignSystem(here)).toBeNull();
  });
});
