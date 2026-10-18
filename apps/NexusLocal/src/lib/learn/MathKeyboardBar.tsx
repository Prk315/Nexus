/**
 * Matematik/kode-tastaturbar til touch-enheder — svaret på at iOS-tastaturet
 * hverken kan σ, Σ, ‖·‖ eller `range(` uden tre lag symbolskift.
 *
 * Én global bar, IKKE per-felt wiring: den lytter på focusin/focusout og
 * klæber sig til ethvert <input type=text>/<textarea> i Learn-fladerne, så
 * nye drill-typer får den gratis ("altid aktiv"). Kun på coarse pointer —
 * desktop har et rigtigt tastatur og ser den aldrig.
 *
 * Tre etager, nederst mod tastaturet:
 *   chips  — "gør sætningen færdig": token-fuldførelse mod et ordforråd af
 *            python/numpy-navne + matematiktermer + ordene i feltets eget
 *            prompt-nærmiljø, plus luk-parentes og ✓ (send Enter).
 *   symbols — Mat/Kode-faner med de tegn iOS gemmer væk.
 *
 * iOS-detaljen der bærer det hele: knapperne bruger onPointerDown +
 * preventDefault, så feltet ALDRIG mister fokus (ellers lukker tastaturet
 * ved hvert tryk). Indsættelse går gennem prototypens value-setter + et
 * syntetisk input-event, så Reacts controlled inputs ser ændringen som om
 * brugeren tastede den.
 *
 * Placering: visualViewport-sporing. Fixed bottom:0 ligger UNDER iOS'
 * tastatur; baren translater sig til visualViewport's underkant i stedet.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// "." og "/" i Mat-rækken er ikke pynt: iOS' danske decimal-pad har komma
// og INTET punktum, og brøksvar ("2/3") er standardformen i drills.
const MATH_KEYS = [
  ".", "/", "√", "²", "³", "^", "·", "×", "÷", "≈", "≠", "±",
  "π", "σ", "μ", "λ", "Σ", "θ", "∞", "∈", "≤", "≥", "→", "½",
];
const CODE_KEYS = [
  "=", "+", "-", "*", "/", "_", "(", ")", "[", "]", "{", "}",
  ":", ",", ".", "\"", "'", "<", ">", "%", "#", "!", "&", "|",
];

/** Ordforråd for fuldførelses-chips. Python/numpy fordi kodeøvelserne og
 *  Python-terminalen er de tunge skriveflader; matematiktermerne er dem
 *  drills faktisk beder om på dansk. Bevidst statisk + lille — en forkert
 *  "forudsigelse" koster mere tillid end en manglende. */
const VOCAB = [
  "print(", "range(", "len(", "sum(", "def ", "return ", "for ", "in ",
  "if ", "else:", "elif ", "while ", "import ", "lambda ", "True", "False",
  "None", "np.array([", "np.mean(", "np.sum(", "np.sqrt(", "np.arange(",
  "np.linalg.norm(", "plt.plot(", "plt.show()", "pd.DataFrame(",
  "varians", "middelværdi", "standardafvigelse", "spredning", "hældning",
  "skæring", "sandsynlighed", "uafhængig", "betinget", "fordeling",
  "gradient", "vektor", "matrix", "determinant", "egenværdi", "egenvektor",
  "ortogonal", "projektion", "entropi", "overfitting", "underfitting",
];

const OPEN_TO_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "‖": "‖" };

type Field = HTMLInputElement | HTMLTextAreaElement;

function isEditable(el: unknown): el is Field {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement)
    return ["text", "search", "number", ""].includes(el.type) || el.type == null;
  return false;
}

/** Indsæt ved caret gennem prototypens setter, så React-controlled felter
 *  opdager ændringen (en direkte .value-skrivning gør de ikke). */
function insertAtCaret(field: Field, text: string, caretBack = 0) {
  const proto = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const next = field.value.slice(0, start) + text + field.value.slice(end);
  if (setter) setter.call(field, next); else field.value = next;
  const caret = start + text.length - caretBack;
  try { field.setSelectionRange(caret, caret); } catch { /* number-inputs nægter — ok */ }
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Det igangværende token bag caret — ordet "finish the sentence" fuldfører. */
function currentToken(field: Field): string {
  const upto = field.value.slice(0, field.selectionStart ?? field.value.length);
  const m = upto.match(/[\wæøåÆØÅ.]+$/);
  return m ? m[0] : "";
}

/** Uafsluttede parenteser i feltet, inderste sidst — til luk-chippen. */
function openBrackets(value: string): string[] {
  const stack: string[] = [];
  for (const ch of value) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(OPEN_TO_CLOSE[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }
  return stack;
}

export function MathKeyboardBar() {
  const [field, setField] = useState<Field | null>(null);
  const [tab, setTab] = useState<"mat" | "kode">("mat");
  const [, bump] = useState(0); // re-render ved input, så chips følger teksten
  const barRef = useRef<HTMLDivElement>(null);
  const coarse = typeof window !== "undefined"
    && window.matchMedia?.("(pointer: coarse)")?.matches;

  // ── Global fokus-sporing: baren følger ethvert redigerbart felt.
  useEffect(() => {
    if (!coarse) return;
    const onFocus = (e: FocusEvent) => { if (isEditable(e.target)) setField(e.target); };
    const onBlur = (e: FocusEvent) => {
      // Fokus flyttet TIL baren tæller ikke som blur (pointerdown preventer
      // default, men vær robust hvis en browser alligevel flytter fokus).
      const to = (e as FocusEvent & { relatedTarget?: Element | null }).relatedTarget;
      if (to && barRef.current?.contains(to)) return;
      if (e.target === field) setField(null);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, [coarse, field]);

  // ── Chips skal følge det der tastes — lyt på feltets input.
  useEffect(() => {
    if (!field) return;
    const on = () => bump((n) => n + 1);
    field.addEventListener("input", on);
    return () => field.removeEventListener("input", on);
  }, [field]);

  // ── iOS: fixed bottom:0 ligger under tastaturet. Følg visualViewport.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = barRef.current;
    if (!vv || !el) return;
    const place = () => {
      const bottomGap = window.innerHeight - (vv.offsetTop + vv.height);
      el.style.transform = `translateY(${-bottomGap}px)`;
    };
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, [field]);

  const press = useCallback((fn: (f: Field) => void) =>
    (e: React.PointerEvent) => {
      e.preventDefault(); // feltet beholder fokus — tastaturet bliver oppe
      if (field) fn(field);
    }, [field]);

  if (!coarse || !field) return null;

  const token = currentToken(field);
  const completions = token.length >= 2
    ? VOCAB.filter((w) => w.toLowerCase().startsWith(token.toLowerCase()) && w.length > token.length).slice(0, 4)
    : [];
  const brackets = openBrackets(field.value);

  const btn = "min-w-[34px] rounded-lg bg-white px-2 py-2 text-[15px] leading-none text-[#1A1A24] shadow-[0_1px_2px_rgba(0,0,0,0.12)] active:bg-indigo-100";

  return (
    <div
      ref={barRef}
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-black/10 bg-[#ECEBE7]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      {/* chips — fuldfør / luk / send */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 pt-1.5">
        {completions.map((w) => (
          <button key={w} className="shrink-0 rounded-full bg-indigo-600/10 px-3 py-1.5 text-[13px] font-medium text-indigo-700"
            onPointerDown={press((f) => insertAtCaret(f, w.slice(token.length)))}>
            {w.trim()}
          </button>
        ))}
        {brackets.length > 0 && (
          <button className="shrink-0 rounded-full bg-amber-500/15 px-3 py-1.5 text-[13px] font-medium text-amber-800"
            onPointerDown={press((f) => insertAtCaret(f, brackets.slice().reverse().join("")))}>
            luk {brackets.slice().reverse().join("")}
          </button>
        )}
        <div className="ml-auto" />
        <button className="shrink-0 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[13px] font-semibold text-white"
          onPointerDown={press((f) => {
            // "færdig": Enter til feltet — alle drill-felter submitter på Enter.
            for (const type of ["keydown", "keyup"] as const) {
              f.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
            }
          })}>
          ✓ færdig
        </button>
      </div>
      {/* symboler */}
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        <div className="flex flex-col gap-1">
          {(["mat", "kode"] as const).map((t) => (
            <button key={t}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold ${tab === t ? "bg-[#1A1A24] text-white" : "bg-white text-[#1A1A24]/60"}`}
              onPointerDown={(e) => { e.preventDefault(); setTab(t); }}>
              {t === "mat" ? "√x" : "{ }"}
            </button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-12 gap-1">
          {(tab === "mat" ? MATH_KEYS : CODE_KEYS).map((k) => (
            <button key={k} className={btn}
              onPointerDown={press((f) => insertAtCaret(f, k))}>
              {k}
            </button>
          ))}
        </div>
        <button className={`${btn} self-stretch`} aria-label="slet"
          onPointerDown={press((f) => {
            const start = f.selectionStart ?? f.value.length;
            const end = f.selectionEnd ?? start;
            if (end > 0) {
              const from = start === end ? start - 1 : start;
              f.setSelectionRange(from, end);
              insertAtCaret(f, "");
            }
          })}>
          ⌫
        </button>
      </div>
    </div>
  );
}
