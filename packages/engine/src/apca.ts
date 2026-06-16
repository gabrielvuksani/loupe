// apca-w3 ships no type declarations. Isolate the untyped import behind a typed
// boundary here so consumers that compile the engine source stay typecheck-clean.
// @ts-ignore - apca-w3 has no .d.ts
import { calcAPCA } from "apca-w3";

const rawApca = calcAPCA as (text: string, bg: string) => number;

// APCA Lc magnitude (0 to ~108) for two CSS rgb() colors.
export function apcaLc(fgRgb: string, bgRgb: string): number {
  const lc = rawApca(fgRgb, bgRgb);
  return Number.isFinite(lc) ? Math.round(Math.abs(lc)) : 0;
}
