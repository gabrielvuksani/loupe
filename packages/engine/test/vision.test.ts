import { describe, it, expect } from "vitest";
import { colorVisionFindings, simulateCvd, svgColorMatrix } from "../src/vision";

describe("colorVisionFindings: color-blind confusable pairs", () => {
  it("flags a red/green pair that is distinct to normal vision but collapses under CVD", () => {
    // The classic error/success pairing: distinct to most people, nearly
    // identical to a red-green color-blind viewer.
    const findings = colorVisionFindings(["#e74c3c", "#2ecc71"]);
    const f = findings.find((x) => x.ruleId === "color-vision");
    expect(f).toBeDefined();
    expect(f?.category).toBe("a11y");
    expect(f?.severity).toBe("medium");
    expect(f?.message).toMatch(/#e74c3c/i);
    expect(f?.message).toMatch(/#2ecc71/i);
    expect(f?.message).toMatch(/red-green|protanopia|deuteranopia/i);
  });

  it("stays silent on a color-blind-safe pair (blue and orange survive simulation)", () => {
    expect(colorVisionFindings(["#2980b9", "#e67e22"])).toEqual([]);
  });

  it("ignores two shades of the same hue: they are not distinct to begin with", () => {
    expect(colorVisionFindings(["#2980b9", "#3498db"])).toEqual([]);
  });

  it("never fires on a neutral palette (greys carry no hue to lose)", () => {
    expect(colorVisionFindings(["#111111", "#444444", "#888888", "#cccccc"])).toEqual([]);
  });

  it("returns nothing for a single color or an empty palette", () => {
    expect(colorVisionFindings(["#e74c3c"])).toEqual([]);
    expect(colorVisionFindings([])).toEqual([]);
  });

  it("reports each confusable pair once, not per deficiency", () => {
    const findings = colorVisionFindings(["#e74c3c", "#2ecc71"]);
    expect(findings).toHaveLength(1);
  });
});

describe("simulateCvd and svgColorMatrix", () => {
  it("pulls a red and a green closer together than normal vision sees them", () => {
    // The mechanism behind the rule: under deuteranopia the two are nearer.
    const red: [number, number, number] = [231, 76, 60];
    const green: [number, number, number] = [46, 204, 113];
    const normal = Math.hypot(red[0] - green[0], red[1] - green[1], red[2] - green[2]);
    const sr = simulateCvd(red, "deuteranopia");
    const sg = simulateCvd(green, "deuteranopia");
    const simmed = Math.hypot(sr[0] - sg[0], sr[1] - sg[1], sr[2] - sg[2]);
    expect(simmed).toBeLessThan(normal);
  });

  it("emits a 20-value feColorMatrix string with an identity alpha row", () => {
    const values = svgColorMatrix("protanopia").split(/\s+/).map(Number);
    expect(values).toHaveLength(20);
    // alpha row: 0 0 0 1 0
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});
