// Turns a Reader node's stored content into a ReaderDoc.
//
// The node's row in vault_content is a POINTER, not the document:
//
//     {"v":1,"source":"/reader-proto/kalkulus/reader.json"}
//
// which is how ten page images and 70 kB of blocks live in the dev server's
// public folder during the prototype instead of in the database. The other
// shape — the reader JSON stored inline — is supported on the same path so that
// the day the assets move into Storage, nothing in the reader changes.

import type { ReaderDoc } from "./readerTypes";

export interface ReaderPointer {
  v: number;
  source: string;
}

function isPointer(value: unknown): value is ReaderPointer {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as ReaderPointer).source === "string" &&
    !Array.isArray((value as { pages?: unknown }).pages)
  );
}

function assertDoc(value: unknown, whence: string): ReaderDoc {
  const doc = value as ReaderDoc;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.pages)) {
    throw new Error(`${whence} is not a reader document (no pages array)`);
  }
  return doc;
}

/**
 * Resolve stored content to a document.
 *
 * `signal` is not optional in practice: a reader node can be closed before a
 * 3 MB fetch of page data lands, and a setState after that is a warning today
 * and a leak in every tab that ever opened the node.
 */
export async function loadReaderDoc(content: string, signal?: AbortSignal): Promise<ReaderDoc> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("This Reader node has no content yet.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("This Reader node's content is not JSON.");
  }

  if (!isPointer(parsed)) return assertDoc(parsed, "The stored content");

  const res = await fetch(parsed.source, { signal });
  if (!res.ok) {
    // The single most likely failure in the prototype, so it says what to do
    // about it rather than "404".
    throw new Error(
      `Could not load ${parsed.source} (${res.status}). ` +
      `Run ./scripts/reader-proto/run.sh from apps/Vault/Vault to regenerate it.`,
    );
  }
  return assertDoc(await res.json(), parsed.source);
}
