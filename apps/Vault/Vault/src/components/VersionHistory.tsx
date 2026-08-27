import { useEffect, useMemo, useRef, useState } from "react";
import { memberName } from "@nexus/core/members";
import * as api from "../lib/api";
import { useConfirm } from "./ConfirmDialog";
import { diffContent, formatBytes, noteLines, relativeTime } from "../lib/versionDiff";
import type { ContentVersion, VersionOrigin } from "../lib/api";

// The History panel: what this note used to be, and a way back.
//
// Two things it deliberately does NOT do:
//
//  * It never mounts an editor on an old version. Rendering is a flat text
//    projection (lib/versionDiff.ts) precisely because an editor that exists
//    can emit, and one emit autosaves the old document over the current one.
//    It also means a version whose schema this build cannot parse is still
//    viewable — the case where history matters most.
//  * It never writes. Restoring is handed back to EditorPane through
//    `onRestore`, because applying a document is the editor's job under live
//    co-editing (the change has to travel through the CRDT to the other person)
//    and a component that both reads history and writes documents would have to
//    know which of those two worlds it is in.

const ORIGIN_LABELS: Record<VersionOrigin, string> = {
  autosave: "",
  conflict: "before a conflicting save",
  restore: "before a restore",
  overwrite: "before an overwrite",
  manual: "checkpoint",
};

interface Props {
  nodeId: string;
  nodeName: string;
  /** The document as it stands in the editor right now — the diff baseline. */
  currentContent: string;
  /**
   * True when this note is being live co-edited. It changes what restoring
   * MEANS, and saying so is not decoration: under a CRDT the restore is a live
   * edit that lands on the other person's screen mid-sentence, and it cannot be
   * "just mine".
   */
  collab: boolean;
  onRestore: (data: string) => Promise<void>;
  onClose: () => void;
}

export function VersionHistory({ nodeId, nodeName, currentContent, collab, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const { confirm, dialog } = useConfirm();

  // Guards a body fetch that outlives its selection — clicking down the list
  // faster than the network answers would otherwise settle an older request
  // last and show the wrong version's text under the right version's header.
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.listContentVersions(nodeId);
        if (!cancelled) setVersions(rows);
      } catch (e) {
        // Most likely cause by far: the migration has not been applied to this
        // project yet, which PostgREST reports as a missing table. Say that
        // rather than render an empty list, which would read as "this note has
        // no history" — the same lie an unseeded blocking_state would tell.
        console.error("[vault] could not load content history", e);
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  useEffect(() => {
    if (selected == null) { setBody(null); return; }
    const ticket = ++requestRef.current;
    setBodyLoading(true);
    (async () => {
      try {
        const data = await api.readContentVersion(selected);
        if (requestRef.current === ticket) setBody(data);
      } catch (e) {
        console.error("[vault] could not read version", e);
        if (requestRef.current === ticket) setBody("");
      } finally {
        if (requestRef.current === ticket) setBodyLoading(false);
      }
    })();
  }, [selected]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    }
    // Capture phase, same reasoning as ConfirmDialog: Vault's global Escape
    // binding must not also act on whatever is behind this panel.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const diff = useMemo(
    () => (body == null ? null : diffContent(body, currentContent)),
    [body, currentContent]
  );

  // Both memoised on `currentContent`, and the byte count is why. Versions
  // report `octet_length` from Postgres, so the "Now" row has to be bytes too or
  // the one number the eye compares down the column is measured two ways. That
  // means encoding the whole document — cheap once, and a fresh allocation of a
  // multi-megabyte note on every keystroke behind an open panel otherwise.
  const current = useMemo(
    () => ({
      lines: noteLines(currentContent).length,
      bytes: new TextEncoder().encode(currentContent).length,
    }),
    [currentContent]
  );

  async function handleRestore(version: ContentVersion) {
    if (body == null || restoring) return;
    const ok = await confirm({
      title: "Restore this version?",
      message: `“${nodeName}” will be replaced by the version from ${relativeTime(version.created_at)}.`,
      details: [
        `${diff?.added ?? 0} line(s) written since then will be removed.`,
        `${diff?.removed ?? 0} line(s) from that version will come back.`,
        "The note as it is right now is snapshotted first, so this is reversible.",
        ...(collab
          ? ["This note is being co-edited — the other person sees the restore immediately."]
          : []),
      ],
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setRestoring(true);
    try {
      await onRestore(body);
      onClose();
    } catch (e) {
      console.error("[vault] restore failed", e);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  }

  const chosen = versions?.find((v) => v.id === selected) ?? null;

  return (
    // The confirmation is a SIBLING of the backdrop, not a child of it. Nested,
    // a pointerdown on `.confirm-backdrop` (its cancel gesture) would bubble
    // into `.vh-backdrop`'s onPointerDown and close the history panel too — so
    // backing out of "restore?" would also throw away the comparison you used
    // to get there.
    <>
    <div className="vh-backdrop" onPointerDown={onClose}>
      <div
        className="vh-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`History for ${nodeName}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="vh-header">
          <div>
            <div className="vh-title">History</div>
            <div className="vh-subtitle">{nodeName}</div>
          </div>
          <button className="vh-close" type="button" onClick={onClose} aria-label="Close history">✕</button>
        </div>

        <div className="vh-body">
          <div className="vh-list" role="listbox" aria-label="Earlier versions">
            <div className="vh-list-head">
              {versions ? `${versions.length} saved iteration${versions.length === 1 ? "" : "s"}` : "Loading…"}
            </div>
            <div className={`vh-row vh-row-current${selected == null ? " vh-row-active" : ""}`}>
              <div className="vh-row-main">
                <span className="vh-row-when">Now</span>
                <span className="vh-row-badge vh-row-badge-live">in this editor</span>
              </div>
              <div className="vh-row-meta">
                {current.lines} line{current.lines === 1 ? "" : "s"} · {formatBytes(current.bytes)}
              </div>
            </div>
            {versions?.map((v) => (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={selected === v.id}
                className={`vh-row${selected === v.id ? " vh-row-active" : ""}`}
                onClick={() => setSelected(v.id)}
              >
                <div className="vh-row-main">
                  <span className="vh-row-when" title={new Date(v.created_at).toLocaleString()}>
                    {relativeTime(v.created_at)}
                  </span>
                  {ORIGIN_LABELS[v.origin] && (
                    <span className="vh-row-badge">{ORIGIN_LABELS[v.origin]}</span>
                  )}
                </div>
                <div className="vh-row-meta">
                  {v.user_id ? memberName(v.user_id) : "unknown"} · {formatBytes(v.byte_len)}
                </div>
              </button>
            ))}
            {versions && versions.length === 0 && !loadError && (
              <div className="vh-empty">
                No earlier iterations yet. Vault snapshots a note at most once every
                five minutes of editing, so the first one appears shortly after you
                start changing this note.
              </div>
            )}
          </div>

          <div className="vh-detail">
            {loadError ? (
              <div className="vh-error">
                <strong>History is unavailable.</strong>
                <div className="vh-error-detail">{loadError}</div>
                <div className="vh-error-hint">
                  If this says the table is missing, apply
                  <code> supabase/migrations/20260827160000_vault_content_versions.sql</code>.
                </div>
              </div>
            ) : chosen == null ? (
              <div className="vh-placeholder">
                <p>Pick an iteration on the left to compare it with the note as it is now.</p>
                <p className="vh-placeholder-dim">
                  Lines the current note has and the old version doesn’t are marked{" "}
                  <span className="vh-chip vh-chip-add">added</span>; lines only the old
                  version has are marked <span className="vh-chip vh-chip-del">removed</span>.
                  Restoring swaps the two.
                </p>
              </div>
            ) : (
              <>
                <div className="vh-detail-head">
                  <div className="vh-detail-title">
                    {relativeTime(chosen.created_at)}
                    <span className="vh-detail-abs">{new Date(chosen.created_at).toLocaleString()}</span>
                  </div>
                  <div className="vh-detail-stats">
                    {diff && !diff.truncated ? (
                      <>
                        <span className="vh-chip vh-chip-add">+{diff.added}</span>
                        <span className="vh-chip vh-chip-del">−{diff.removed}</span>
                      </>
                    ) : diff?.truncated ? (
                      <span className="vh-chip vh-chip-warn">too long to compare</span>
                    ) : null}
                  </div>
                </div>

                <div className="vh-diff">
                  {bodyLoading ? (
                    <div className="vh-placeholder">Loading that iteration…</div>
                  ) : diff && diff.rows.length === 0 ? (
                    <div className="vh-placeholder">That version was empty.</div>
                  ) : (
                    diff?.rows.map((row, i) => (
                      <div key={i} className={`vh-line vh-line-${row.kind}`}>
                        <span className="vh-line-sign">
                          {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
                        </span>
                        <span className="vh-line-text">{row.text}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="vh-actions">
                  {diff?.truncated && (
                    <span className="vh-actions-note">
                      Shown undiffed — this note is too long to compare line by line.
                    </span>
                  )}
                  <button
                    type="button"
                    className="vh-btn vh-btn-primary"
                    disabled={bodyLoading || restoring || body == null}
                    onClick={() => void handleRestore(chosen)}
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    {dialog}
    </>
  );
}
