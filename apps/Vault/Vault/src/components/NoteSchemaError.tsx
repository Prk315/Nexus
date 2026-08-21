// Shown INSTEAD of the note editor when a note contains block types this build
// doesn't know about — see lib/noteSchemaGuard.ts for why that must never
// reach an editor.
//
// The single job of this component is to not be an editor. No Tiptap instance
// is mounted, so nothing can emit `onUpdate`, so the 400ms autosave in
// EditorPane never fires and the stored content is physically unreachable from
// here. Everything else is explanation.

import { useMemo, useState } from "react";
import { generateHTML, rewriteUnknownContent } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "../extensions/noteExtensions";
import { parseNoteContent, describeUnknown, type SchemaAudit } from "../lib/noteSchemaGuard";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  audit: SchemaAudit;
  /** The raw stored string — never mutated here except via onRecover. */
  content: string;
  /** EditorPane's setContent. Calling it arms the autosave, so gate it. */
  onRecover: (content: string) => void;
}

export function NoteSchemaError({ audit, content, onRecover }: Props) {
  const { confirm, dialog } = useConfirm();
  const [converting, setConverting] = useState(false);

  // Strip the unknown types to get something renderable. This is display-only:
  // `cleaned` is never written back unless the user explicitly converts.
  const { previewHtml, cleaned, lost } = useMemo(() => {
    const shape = parseNoteContent(content);
    if (shape.kind !== "json") return { previewHtml: "", cleaned: null, lost: 0 };
    try {
      const res = rewriteUnknownContent(shape.json as JSONContent, noteSchema());
      const json = res.json;
      return {
        previewHtml: json ? generateHTML(json, buildNoteExtensions()) : "",
        cleaned: json,
        lost: res.rewrittenContent?.length ?? 0,
      };
    } catch (e) {
      console.error("[vault] could not build a read-only preview", e);
      return { previewHtml: "", cleaned: null, lost: 0 };
    }
  }, [content]);

  const names = describeUnknown(audit);

  async function handleConvert() {
    if (!cleaned) return;
    const ok = await confirm({
      title: "Convert to plain blocks?",
      message:
        `This permanently replaces the ${names} block${audit.unknownNodes.length + audit.unknownMarks.length === 1 ? "" : "s"} ` +
        `with plain text and saves over the stored note. It cannot be undone.`,
      details: [
        "Updating Vault instead keeps everything, including the original blocks.",
        lost > 0 ? `${lost} block${lost === 1 ? "" : "s"} would be rewritten.` : "",
      ].filter(Boolean),
      confirmLabel: "Convert and lose blocks",
      cancelLabel: "Keep the note as it is",
    });
    if (!ok) return;
    setConverting(true);
    onRecover(JSON.stringify(cleaned));
  }

  return (
    <div className="note-schema-error">
      <div className="nse-card">
        <div className="nse-icon" aria-hidden="true">⚠</div>
        <h2 className="nse-title">This note uses blocks this version of Vault doesn't understand</h2>
        <p className="nse-body">
          Unrecognised: <code className="nse-types">{names}</code>
        </p>
        <p className="nse-body nse-reassure">
          <strong>Your note is safe.</strong> It hasn't been opened for editing and nothing has been
          written to the server — that's exactly why this screen is here instead of the editor.
        </p>
        <p className="nse-body">
          It was almost certainly written on a device running a newer build. To edit it here, update
          Vault:
        </p>
        <ul className="nse-steps">
          <li><strong>Web</strong> — hard-reload the page (⇧⌘R).</li>
          <li><strong>Mac</strong> — rebuild or reinstall the app.</li>
          <li><strong>iPad</strong> — re-run <code>npm run ios:vault</code>; it does not update on its own.</li>
        </ul>
        <div className="nse-actions">
          <button className="nse-btn nse-btn-primary" type="button" onClick={() => location.reload()}>
            Reload
          </button>
          {cleaned && (
            <button
              className="nse-btn nse-btn-danger"
              type="button"
              onClick={handleConvert}
              disabled={converting}
            >
              {converting ? "Converting…" : "Convert to plain blocks and edit"}
            </button>
          )}
        </div>
      </div>

      {previewHtml && (
        <div className="nse-preview">
          <div className="nse-preview-label">Read-only preview — unsupported blocks omitted</div>
          {/* Rendered from the schema's own renderHTML, not from stored markup,
              so this cannot inject anything the editor wouldn't produce. */}
          <div className="nse-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}

      {dialog}
    </div>
  );
}
