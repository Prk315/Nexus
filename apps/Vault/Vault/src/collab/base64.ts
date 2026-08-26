// Yjs speaks Uint8Array; Supabase Realtime broadcast payloads and the
// vault_ydoc.state column are both JSON text. base64 is the bridge.
//
// Text rather than bytea/hex for the column deliberately: vault_content.data
// is already text, PostgREST hands it back as a plain JSON string, and the
// client needs no hex parser. Both encodings cost ~2x.

const CHUNK = 0x8000; // 32k bytes per String.fromCharCode call

/**
 * Encode bytes as standard base64.
 *
 * Deliberately chunked rather than the one-liner
 * `btoa(String.fromCharCode(...bytes))`. Spreading a Uint8Array into
 * `fromCharCode` passes one argument per byte, so it blows the engine's
 * argument-count limit and throws `RangeError: Maximum call stack size
 * exceeded` somewhere around 100–125 kB. That is precisely the size a note
 * reaches once it matters, and it never shows up in a small test — so the
 * naive version looks correct for months and then fails on the one document
 * someone has actually been writing in.
 */
export function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
