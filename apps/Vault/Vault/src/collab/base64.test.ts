import { describe, it, expect } from "vitest";
import { toB64, fromB64 } from "./base64";

describe("base64", () => {
  it("round-trips an empty buffer", () => {
    expect(fromB64(toB64(new Uint8Array()))).toEqual(new Uint8Array());
  });

  it("round-trips every byte value", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(fromB64(toB64(all))).toEqual(all);
  });

  // The point of the whole module. `btoa(String.fromCharCode(...bytes))` passes
  // one argument per byte and throws `RangeError: Maximum call stack size
  // exceeded` somewhere past ~100 kB — which is exactly the size a note reaches
  // once someone has actually been writing in it, and never the size a
  // convenient test buffer reaches. A small round-trip passes with the broken
  // implementation, so it has to be big.
  it("round-trips 300 kB without blowing the call stack", () => {
    const big = new Uint8Array(300_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const encoded = toB64(big);
    expect(encoded.length).toBeGreaterThan(300_000);
    expect(fromB64(encoded)).toEqual(big);
  });

  it("produces standard base64 a decoder agrees with", () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(toB64(bytes)).toBe("aGVsbG8=");
  });
});
