// apca-w3 ships no types; declare the functions we use.
declare module "apca-w3" {
  export function calcAPCA(
    text: string | number[],
    bg: string | number[],
    places?: number,
    isInt?: boolean,
  ): number;
  export function APCAcontrast(txtY: number, bgY: number): number;
  export function sRGBtoY(rgb: number[]): number;
}
