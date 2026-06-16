import { describe, it, expect, vi, beforeEach } from "vitest";

// Controllable dns.promises.lookup so the rebinding cases are deterministic and
// never touch the network. Each test sets lookupImpl before calling.
let lookupImpl: (host: string) => Promise<Array<{ address: string; family: number }>>;
vi.mock("node:dns", () => ({
  promises: {
    lookup: (host: string) => lookupImpl(host),
  },
}));

import { isBlockedAddress, assertRenderableUrl } from "../src/playwright-adapter";

describe("connected · isBlockedAddress (pure)", () => {
  it("blocks IPv4 link-local / metadata addresses", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 form of the metadata address", () => {
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("blocks alternative integer encodings of the metadata address", () => {
    // 2852039166 === 0xA9FEA9FE === 169.254.169.254
    expect(isBlockedAddress("2852039166")).toBe(true);
    expect(isBlockedAddress("0xA9FEA9FE")).toBe(true);
  });

  it("blocks IPv6 link-local fe80::/10", () => {
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("allows loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(false);
    expect(isBlockedAddress("::1")).toBe(false);
  });

  it("allows RFC1918 private ranges (the legitimate dev-server targets)", () => {
    expect(isBlockedAddress("10.0.0.5")).toBe(false);
    expect(isBlockedAddress("172.16.0.1")).toBe(false);
    expect(isBlockedAddress("192.168.1.10")).toBe(false);
  });

  it("allows public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });
});

describe("connected · assertRenderableUrl (scheme + DNS rebinding guard)", () => {
  beforeEach(() => {
    // Default: resolve to a harmless public address.
    lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  });

  it("rejects non-http(s) schemes before any DNS work", async () => {
    await expect(assertRenderableUrl("file:///etc/passwd")).rejects.toThrow(/non-http/);
  });

  it("rejects an invalid URL", async () => {
    await expect(assertRenderableUrl("not a url")).rejects.toThrow(/Invalid URL/);
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    await expect(assertRenderableUrl("http://example.com/")).resolves.toBeUndefined();
  });

  it("allows localhost (core loupe dev-loop target)", async () => {
    lookupImpl = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(assertRenderableUrl("http://localhost:3000/")).resolves.toBeUndefined();
  });

  it("allows an RFC1918 dev server", async () => {
    lookupImpl = async () => [{ address: "192.168.1.50", family: 4 }];
    await expect(assertRenderableUrl("http://dev.box:5173/")).resolves.toBeUndefined();
  });

  it("blocks a hostname that resolves to the metadata IP (DNS rebinding)", async () => {
    lookupImpl = async () => [{ address: "169.254.169.254", family: 4 }];
    await expect(assertRenderableUrl("http://rebind.evil/")).rejects.toThrow(/link-local|metadata/i);
  });

  it("blocks when ANY resolved address is link-local, even if another is public", async () => {
    lookupImpl = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await expect(assertRenderableUrl("http://mixed.evil/")).rejects.toThrow(/link-local|metadata/i);
  });

  it("blocks the literal GCP metadata hostnames before DNS resolves", async () => {
    // lookup would resolve public, but the hostname itself must be refused.
    lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(assertRenderableUrl("http://metadata.google.internal/")).rejects.toThrow(
      /link-local|metadata/i,
    );
    await expect(assertRenderableUrl("http://metadata.goog/")).rejects.toThrow(/link-local|metadata/i);
  });

  it("does NOT throw when DNS resolution itself fails (let the render fail naturally)", async () => {
    lookupImpl = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertRenderableUrl("http://nonexistent.invalid/")).resolves.toBeUndefined();
  });
});
