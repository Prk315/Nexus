import { useEffect, useRef, useState } from "react";
import type { MacroDictionary, MathfieldElement } from "mathlive";
import { KATEX_MACROS } from "../lib/katexShared";

// Word-style visual equation editor (M2 "math mode"). This wraps MathLive's
// <math-field> custom element. mathlive is ~600KB and pulls in its own KaTeX
// fork + fonts, so it must never land in the entry chunk — it is loaded here
// via a dynamic import, on demand, the first time a MathField actually
// mounts. Only NoteEditor.tsx and CanvasEditor.tsx (both already lazy chunks)
// may import this module; importing it anywhere eagerly would defeat the
// point.

let mathlivePromise: Promise<typeof import("mathlive")> | null = null;
let configured = false;

function loadMathlive() {
  if (!mathlivePromise) {
    mathlivePromise = import("mathlive").then(mod => {
      if (!configured) {
        // Per mathfield-element.d.ts: "Changing this setting after the
        // mathfield has been created will have no effect" — these are
        // statics on the class, so they must be set exactly once, before
        // the first <math-field> is created. `/mathlive-fonts` mirrors the
        // public/pdfjs-fonts convention (see CLAUDE.md) and is populated
        // from node_modules/mathlive/fonts by copying, not importing
        // mathlive-fonts.css.
        mod.MathfieldElement.fontsDirectory = "/mathlive-fonts";
        // soundsDirectory = null "suppresses" all keypress/plonk sound
        // loading (mathfield-element.d.ts: "If the soundsDirectory is null,
        // no sound will be played") — Vault has no sound design anywhere
        // else, so silence is the correct default here too.
        mod.MathfieldElement.soundsDirectory = null;
        configured = true;
      }
      return mod;
    });
  }
  return mathlivePromise;
}

// Vault's shared KaTeX macro dictionary (src/lib/katexShared.ts) and
// MathLive's MacroDictionary use different shapes:
//  - KaTeX macro keys are the bare control word including the backslash
//    ("\R"); MathLive keys omit the leading backslash ("R").
//  - KATEX_MACROS encodes argument-taking macros by appending the arg
//    placeholders to the *key* itself, e.g. "\abs{#1}": "\left|#1\right|".
//    That is not a form KaTeX's own `macros` option actually honors —
//    verified with `katex.renderToString("\\abs{5}", { macros: {
//    "\\abs{#1}": "\\left|#1\\right|" } })`, which renders `\abs` as an
//    undefined-command error span. So \abs/\norm/\inner/\set/\ceil/\floor
//    have never worked in any of Vault's KaTeX previews. MathLive's
//    dictionary has a real `args` count field, so this adapter recovers the
//    arg count from that key pattern instead of discarding it — these
//    macros come out *working* here even though their KaTeX counterparts
//    don't. Nothing in KATEX_MACROS actually needs to be skipped; the
//    `skipped` return value exists so a future macro that doesn't fit the
//    "\name" / "\name{#1}{#2}..." shape is reported instead of silently
//    dropped or mis-adapted.
function toMathliveMacros(src: Record<string, string>): { macros: MacroDictionary; skipped: string[] } {
  const macros: MacroDictionary = {};
  const skipped: string[] = [];
  for (const [rawKey, def] of Object.entries(src)) {
    const m = /^\\([A-Za-z]+)((?:\{#\d\})*)$/.exec(rawKey);
    if (!m) { skipped.push(rawKey); continue; }
    const [, name, argsPart] = m;
    const argCount = (argsPart.match(/#\d/g) ?? []).length;
    macros[name] = argCount > 0 ? { def, args: argCount } : def;
  }
  return { macros, skipped };
}

const { macros: VAULT_MATH_MACROS, skipped: SKIPPED_MACROS } = toMathliveMacros(KATEX_MACROS);
if (SKIPPED_MACROS.length > 0) {
  // eslint-disable-next-line no-console
  console.warn("[MathField] KaTeX macros that could not be adapted for MathLive:", SKIPPED_MACROS);
}

export interface MathFieldProps {
  value: string;
  onChange: (latex: string) => void;
  autoFocus?: boolean;
  className?: string;
  /**
   * The live element, once it exists. The math toolbar needs a handle to
   * insert into, and it lives in a different React tree — see lib/mathToolbar.
   */
  onFieldReady?: (field: MathfieldElement) => void;
  /** Focus in and out, so the toolbar knows which field it is talking to. */
  onFocusChange?: (focused: boolean, field: MathfieldElement) => void;
}

export function MathField({ value, onChange, autoFocus, className, onFieldReady, onFocusChange }: MathFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Refs, not deps: these must not re-run the imperative mount effect, which
  // is deliberately keyed on `ready` alone.
  const onReadyRef = useRef(onFieldReady);
  onReadyRef.current = onFieldReady;
  const onFocusRef = useRef(onFocusChange);
  onFocusRef.current = onFocusChange;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMathlive().then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Imperative mount, once mathlive is ready. Runs only on the ready
  // transition (not on every `value`/`onChange` change) — the field owns
  // its own DOM/caret state after that; external value changes are synced
  // separately below, only when they actually diverge.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const mf = document.createElement("math-field") as MathfieldElement;
    // Connect BEFORE touching instance getters/setters: MathLive builds its
    // internal mathfield in connectedCallback, and the `macros` getter (among
    // others) throws "Mathfield not mounted" on a detached element — which,
    // uncaught, unmounted the entire editor tree. The element class is
    // already defined (the dynamic import finished), so appendChild upgrades
    // and connects it synchronously.
    hostRef.current.appendChild(mf);
    // `mf.macros` getter returns MathLive's built-in default dictionary;
    // spreading it in (rather than assigning VAULT_MATH_MACROS alone) keeps
    // every stock MathLive macro instead of replacing the whole registry,
    // per mathfield-element.d.ts's own doc example. If this ever throws
    // again, degrade to stock macros — a field without \R beats a blank
    // editor.
    try {
      mf.macros = { ...mf.macros, ...VAULT_MATH_MACROS };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[MathField] could not apply Vault macros, using MathLive defaults:", e);
    }
    // "auto": show the virtual keyboard on touch devices (iPad, the primary
    // target here) without popping it up on desktop where a physical
    // keyboard is already present.
    mf.mathVirtualKeyboardPolicy = "auto";
    mf.value = value;
    const handleInput = () => onChangeRef.current(mf.value);
    mf.addEventListener("input", handleInput);
    const handleFocus = () => onFocusRef.current?.(true, mf);
    const handleBlur = () => onFocusRef.current?.(false, mf);
    mf.addEventListener("focusin", handleFocus);
    mf.addEventListener("focusout", handleBlur);
    mfRef.current = mf;
    onReadyRef.current?.(mf);
    if (autoFocus) {
      // Deferred and guarded: MathLive's focus() runs blur bookkeeping that
      // can still reference a previously disposed field's model (observed:
      // second mount in a page crashed in atomToString via focus→onBlur).
      // One frame lets any pending teardown settle, and focus is cosmetic —
      // a failed focus must never cost more than a missing caret.
      requestAnimationFrame(() => { try { mfRef.current?.focus(); } catch { /* ignore */ } });
    }
    return () => {
      // Blur before removal so MathLive's "currently focused field" tracking
      // never outlives the instance — the stale reference is what a later
      // mount's focus() trips over.
      try { mf.blur(); } catch { /* already disposed */ }
      mf.removeEventListener("input", handleInput);
      mf.removeEventListener("focusin", handleFocus);
      mf.removeEventListener("focusout", handleBlur);
      // Tell the toolbar this field is gone BEFORE the element is destroyed,
      // or it holds a handle whose insert() throws "Mathfield not mounted".
      onFocusRef.current?.(false, mf);
      mf.remove();
      mfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Sync external value → field only when they diverge, so a parent
  // re-render triggered by our own `onChange` doesn't reset the caret to
  // the end of the expression on every keystroke.
  useEffect(() => {
    const mf = mfRef.current;
    if (!mf || mf.value === value) return;
    mf.value = value;
  }, [value]);

  if (!ready) {
    return <div className={["math-field-loading", className].filter(Boolean).join(" ")}>Loading math editor…</div>;
  }

  return <div ref={hostRef} className={className} />;
}
