// Link editor for the note editor's ⌘K.
//
// StarterKit v3 already registers the Link mark, so links have always *worked*
// here — pasting a URL over a selection linked it and autolink caught bare
// URLs. What was missing was any way to see, change or remove one. This is
// that, plus an explicit Open, since links no longer navigate on click while
// the document is editable (see extensions/noteExtensions.ts).

import { useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/platform";

export interface LinkDialogState {
  /** Existing href when editing, "" when creating. */
  href: string;
  /** Text the link will cover; empty when the selection is collapsed. */
  label: string;
  /** True when the cursor is inside an existing link. */
  editing: boolean;
}

interface Props {
  state: LinkDialogState;
  onSave: (href: string, label: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/**
 * Adds a protocol to bare input like "example.com" so the mark's own
 * `isAllowedUri` check accepts it, and rejects anything that isn't http(s) or
 * mailto — a `javascript:` href in a stored note would otherwise be one click
 * away from executing in the app's own origin.
 */
export function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  const allowed = ["http:", "https:", "mailto:"];
  return allowed.includes(url.protocol) ? url.toString() : null;
}

export async function openExternal(href: string) {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(href);
      return;
    } catch (e) {
      console.warn("[vault] tauri opener failed, falling back to window.open", e);
    }
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

export function LinkDialog({ state, onSave, onRemove, onCancel }: Props) {
  const [href, setHref] = useState(state.href);
  const [label, setLabel] = useState(state.label);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Capture phase, same reasoning as ConfirmDialog: a global Escape
      // binding must not also close whatever is rendered behind this.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  function submit() {
    const normalized = normalizeHref(href);
    if (!normalized) {
      setError("Enter a valid http(s) or mailto address.");
      return;
    }
    onSave(normalized, label);
  }

  return (
    <div className="link-dialog-backdrop" onPointerDown={onCancel}>
      <div
        className="link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.editing ? "Edit link" : "Add link"}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="link-dialog-title">{state.editing ? "Edit link" : "Add link"}</div>

        <label className="link-dialog-field">
          <span>URL</span>
          <input
            ref={inputRef}
            value={href}
            onChange={(e) => { setHref(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder="example.com"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
          />
        </label>

        {/* Only offered when there is no selection to wrap — otherwise the
            selected text IS the label and rewriting it would be surprising. */}
        {!state.label && (
          <label className="link-dialog-field">
            <span>Text</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder="(uses the URL)"
            />
          </label>
        )}

        {error && <div className="link-dialog-error">{error}</div>}

        <div className="link-dialog-actions">
          <div className="link-dialog-actions-left">
            {state.editing && (
              <button className="link-dialog-btn link-dialog-btn-remove" type="button" onClick={onRemove}>
                Remove
              </button>
            )}
            {state.editing && normalizeHref(state.href) && (
              <button
                className="link-dialog-btn"
                type="button"
                onClick={() => openExternal(normalizeHref(state.href)!)}
              >
                Open ↗
              </button>
            )}
          </div>
          <div className="link-dialog-actions-right">
            <button className="link-dialog-btn" type="button" onClick={onCancel}>Cancel</button>
            <button className="link-dialog-btn link-dialog-btn-save" type="button" onClick={submit}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
