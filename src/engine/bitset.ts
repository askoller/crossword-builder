// Fixed-size bitsets over word ids, stored in Uint32Array. Pure; used only by the engine.

export function words32(n: number): number {
  return (n + 31) >>> 5;
}

export function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

export function count(a: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) n += popcount32(a[i]);
  return n;
}

/** out = a AND b; returns the number of set bits. `out` may alias `a`. */
export function andInto(out: Uint32Array, a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const v = a[i] & b[i];
    out[i] = v;
    if (v) n += popcount32(v);
  }
  return n;
}

/** Bits set in both, without allocating. */
export function andCount(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] & b[i];
    if (v) n += popcount32(v);
  }
  return n;
}

export function has(a: Uint32Array, i: number): boolean {
  return (a[i >>> 5] & (1 << (i & 31))) !== 0;
}

export function set(a: Uint32Array, i: number): void {
  a[i >>> 5] |= 1 << (i & 31);
}

/** Lowest set bit at or after `from`, or -1. */
export function nextSet(a: Uint32Array, from: number): number {
  let w = from >>> 5;
  if (w >= a.length) return -1;
  let v = a[w] & (~0 << (from & 31));
  for (;;) {
    if (v) return (w << 5) + (31 - Math.clz32(v & -v));
    if (++w >= a.length) return -1;
    v = a[w];
  }
}
