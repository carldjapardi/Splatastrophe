const floatView = new Float32Array(1);
const intView = new Int32Array(floatView.buffer);

/** IEEE 754 binary16. Used for PlayCanvas RGBA16F splat textures. */
export function floatToHalf(value: number): number {
  floatView[0] = value;
  const bits = intView[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;

  if (exponent === 255) {
    if (mantissa !== 0) return sign | 0x7e00;
    return sign | 0x7c00;
  }
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 31) return sign | 0x7c00;
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    let sub = (mantissa | 0x800000) >> (1 - halfExponent);
    const remainder = sub & 0x1fff;
    sub >>= 13;
    if (remainder > 0x1000 || (remainder === 0x1000 && (sub & 1) === 1)) sub += 1;
    return sign | sub;
  }
  let halfMantissa = mantissa >> 13;
  const remainder = mantissa & 0x1fff;
  if (remainder > 0x1000 || (remainder === 0x1000 && (halfMantissa & 1) === 1)) {
    halfMantissa += 1;
    if (halfMantissa === 0x400) return sign | ((halfExponent + 1) << 10);
  }
  return sign | (halfExponent << 10) | halfMantissa;
}
