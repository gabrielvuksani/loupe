// Pure crop geometry for the element screenshot. DOM-free so it is unit-testable
// without a canvas: the content script keeps drawImage/toDataURL, this owns the math.

export interface CropInput {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropImage {
  width: number;
  height: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// Scale the element rect to device pixels, pad it, clamp the origin at 0, and
// clamp the size to what remains inside the captured image from that origin.
export function cropRect(rect: CropInput, dpr: number, img: CropImage, pad: number): CropRect {
  const p = pad * dpr;
  const sx = Math.max(0, rect.left * dpr - p);
  const sy = Math.max(0, rect.top * dpr - p);
  const sw = Math.min(img.width - sx, rect.width * dpr + p * 2);
  const sh = Math.min(img.height - sy, rect.height * dpr + p * 2);
  return { sx, sy, sw, sh };
}
