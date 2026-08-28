// Images in notes — always as a Storage URL, never as inline base64.
//
// This is the one feature in the whole set with a documented body count. On
// 2026-08-15 a canvas document reached 1.9 MB, 69% of it five pasted
// screenshots encoded as base64 data URIs. Every autosave rewrote the entire
// row, the writes queued on the row lock while holding PostgREST connections,
// and the pool went with them — statement timeouts, then 522s across every app
// in the ecosystem for two hours. api.uploadCanvasImage exists because of it.
//
// So: `allowBase64` is off, a paste or drop of an image file uploads first and
// inserts the returned URL, and a pasted data: URI is intercepted and uploaded
// rather than written into the document.

import { Image } from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const imageUploadKey = new PluginKey("vaultNoteImageUpload");

async function uploadAndInsert(editor: any, file: File | Blob, at?: number) {
  try {
    // ⚠️ Imported HERE, not at module scope, and it is not about bundle size.
    //
    // This module is on the note SCHEMA path — noteExtensions imports it, and
    // the schema guard builds the schema to decide whether a stored note is
    // safe to open. `lib/api` reaches `lib/supabase`, which calls
    // `createClient()` at module scope and throws "supabaseUrl is required"
    // when the env is absent. A static import therefore made "is this note
    // safe?" depend on a configured network client — backwards, since the
    // guard exists to run when things are broken.
    //
    // Deferring costs nothing: this runs on a real paste or drop, long after
    // any schema has been built. `lib/schemaPath.test.ts` asserts the rule.
    const api = await import("../lib/api");
    const url = await api.uploadCanvasImage(file);
    // The upload is a network round trip, so the note can easily be closed
    // before it lands. A destroyed editor is still a truthy object whose
    // internals have been nulled, so touching it here throws — the same
    // failure that white-screened the app from the content effect.
    if (!editor || editor.isDestroyed) return;
    const pos = at ?? editor.state.selection.from;
    editor
      .chain()
      .focus()
      .insertContentAt(Math.min(pos, editor.state.doc.content.size), {
        type: "image",
        attrs: { src: url },
      })
      .run();
  } catch (e) {
    // Non-fatal and deliberately loud: silently dropping a pasted screenshot
    // is worse than an error in the console, because the user has no other
    // copy of what was on their clipboard.
    console.error("[vault] image upload failed; nothing was inserted", e);
  }
}

function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
}

export const NoteImage = Image.extend({
  // Above StarterKit so the paste handler below gets first refusal on an
  // image paste, before the default HTML paste turns a data: URI into content.
  priority: 1000,

  addOptions() {
    const parent = this.parent?.();
    return {
      ...parent,
      inline: false,
      // The whole point. A base64 image in a note is a note that can take the
      // database down with it.
      allowBase64: false,
      // v3 ships drag-to-resize; the width lands in the `width` attribute, so
      // it round-trips through HTML like the column widths do.
      resize: { enabled: true, minWidth: 80, alwaysPreserveAspectRatio: true },
      HTMLAttributes: { class: "note-image" },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("width"),
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: imageUploadKey,
        props: {
          handlePaste(_view, event) {
            const files = imageFilesFrom(event.clipboardData);
            if (files.length === 0) {
              // A data: URI can also arrive as HTML rather than as a file —
              // that path is what actually produced the 1.9 MB document.
              const html = event.clipboardData?.getData("text/html") ?? "";
              if (!/<img[^>]+src=["']data:image\//i.test(html)) return false;
              event.preventDefault();
              const srcs = [...html.matchAll(/<img[^>]+src=["'](data:image\/[^"']+)["']/gi)].map(
                (m) => m[1]
              );
              for (const src of srcs) {
                fetch(src)
                  .then((r) => r.blob())
                  .then((blob) => uploadAndInsert(editor, blob))
                  .catch((e) => console.error("[vault] could not read pasted image data", e));
              }
              return true;
            }
            event.preventDefault();
            for (const file of files) void uploadAndInsert(editor, file);
            return true;
          },

          handleDrop(view, event) {
            const files = imageFilesFrom((event as DragEvent).dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            // Drop where the pointer is, not where the caret happened to be.
            const at = view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            })?.pos;
            for (const file of files) void uploadAndInsert(editor, file, at);
            return true;
          },
        },
      }),
    ];
  },
});
