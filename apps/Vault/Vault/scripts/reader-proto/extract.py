#!/usr/bin/env python3
"""
Stage 1 of the Kalkulus reader prototype pipeline: PDF -> page PNGs + raw blocks.

Run it through ./run.sh, which also runs stage 2. Directly:

    python3 apps/Vault/Vault/scripts/reader-proto/extract.py \
        --pdf /Users/bastianthomsen/Desktop/Kalkulus.pdf \
        --out apps/Vault/Vault/public/reader-proto/kalkulus \
        --raw apps/Vault/Vault/scripts/reader-proto/.cache/reader.raw.json

Re-runnable: every output is overwritten from the PDF, nothing is appended.

WHY PyMuPDF AND NOT MARKER
--------------------------
The spec prefers Marker. The only Marker on this machine lives in another
project's venv (LearnAndRetain/exam-pipeline) and is broken there — surya
imports `transformers.onnx`, which the installed transformers no longer ships:

    ModuleNotFoundError: No module named 'transformers.onnx'

Repairing it means editing that project, which this branch may not do. So the
extractor is PyMuPDF, and it buys back most of what Marker would have given us
from a fact about this particular PDF: Kalkulus is LaTeX-typeset, and the font
name on every span says what the span IS.

    NimbusRomNo9L-*          body text
    NimbusSanL-Bold   89.7   chapter numeral      -> heading level 1
    NimbusSanL-Bold   29.9   chapter title        -> heading level 1
    NimbusSanL-Bold   14.3   section heading      -> heading level 2
    NimbusSanL-Bold   12.0   subsection heading   -> heading level 3
    NimbusSanL-Bold   10.0   environment heading  -> concept  ("1.4.2 Binomialformelen")
    NimbusSanL-BoldItal 9.0  proof opener         -> concept  ("Bevis:")
    NimbusSanL-*       8.0   running head / folio -> dropped
    LM* / MSAM / CM          math

That is a stronger and far more predictable signal than a layout model, and it
is why block typing here is deterministic rather than probabilistic.

WHAT IS LOST RELATIVE TO MARKER
-------------------------------
Marker emits LaTeX for math. A PDF has no LaTeX in it — only positioned glyphs
— so `latex` here is a TRANSCRIPTION, reconstructed from span geometry:
super/subscripts from baseline offset and font size, operators from a glyph
map, big delimiters from the LMMathExtension private-use codepoints. It is good
enough to copy and fix, not good enough to trust unread. Every math block
carries `latexIsTranscribed: true` so the UI can say so.

Also lost: no OCR (irrelevant, this PDF has a real text layer) and no table
structure (none of the ten pages has a table).
"""

from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import unicodedata
from datetime import datetime, timezone

import fitz  # PyMuPDF

# ── The ten pages ────────────────────────────────────────────────────────────
# Keys are 0-based PDF page indices. In this PDF the front matter is numbered in
# the same sequence as the body, so the printed book page equals the 1-based PDF
# page exactly; `verify_page_number` asserts that per page rather than trusting
# it. Ordered as a reading order: the binomial-formula thread in chapter 1,
# then two chapter-3 pages, then the opening of chapter 5.
PAGES: list[tuple[int, str]] = [
    (26,  "Chapter 1 opens: display heading, epigraph, first section heading"),
    (52,  "Section 1.4 opens mid-page; Pascal's triangle (figur 1.4.1) above it"),
    (53,  "1.4.1 Eksempel and 1.4.2 Binomialformelen — the binomial theorem"),
    (54,  "Figur 1.4.2, 1.4.4 Lemma, and the Bevis that follows it"),
    (57,  "Oppgaver i seksjon 1.4 — a full exercise page"),
    (132, "Exercise tail, section 3.3 opening, 3.3.1 Definisjon"),
    (228, "Chapter 5 opens: display heading and epigraph"),
    (229, "Figur 5.0.1 — the densest vector figure in the book"),
    (250, "5.3.5 Ekstremalverdisetningen — a named theorem, and the Bevis under it"),
    (252, "Oppgaver i seksjon 5.3 — a second exercise page, different chapter"),
]

SCALE = 2.0  # render at 2x; the reader sizes the image down with CSS

# ── Font classification ──────────────────────────────────────────────────────

MATH_FONT_PREFIXES = ("LMMath", "LMRoman", "LMSans", "LMTypewriter", "MSAM", "MSBM", "CM")


def span_class(font: str) -> str:
    if font.startswith("NimbusSanL-BoldItal"):
        return "bolditalic"
    if font.startswith("NimbusSanL-Bold"):
        return "bold"
    if font.startswith("NimbusSan"):
        return "sans"
    if font.startswith(MATH_FONT_PREFIXES):
        return "math"
    return "text"


# ── Glyph normalisation ──────────────────────────────────────────────────────
# The PDF uses real ligature codepoints, so "Definisjon" arrives as
# "Defiﬁnisjon" — which is why a naive label match finds nothing. Every
# text that leaves this script is normalised, and the TypeScript detector
# normalises again so it is correct on input this script never touched.

LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "ﬅ": "st", "ﬆ": "st",
}


def normalise(text: str) -> str:
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    text = text.replace(" ", " ").replace(" ", " ").replace(" ", " ")
    return text


# ── LaTeX transcription ──────────────────────────────────────────────────────

GLYPH_LATEX = {
    "−": "-",        # MINUS SIGN, not hyphen
    "·": r"\cdot ",
    "→": r"\to ",
    "∞": r"\infty ",
    "√": r"\sqrt ",
    "∈": r"\in ",
    "∉": r"\notin ",
    "⊃": r"\supset ",
    "⊂": r"\subset ",
    "≥": r"\ge ",
    "≤": r"\le ",
    "≠": r"\ne ",
    "≈": r"\approx ",
    "±": r"\pm ",
    "̸": r"\not",
    "α": r"\alpha ", "β": r"\beta ", "γ": r"\gamma ",
    "δ": r"\delta ", "ϵ": r"\epsilon ", "ε": r"\epsilon ",
    "θ": r"\theta ", "λ": r"\lambda ", "μ": r"\mu ",
    "π": r"\pi ", "σ": r"\sigma ", "φ": r"\varphi ",
    "ω": r"\omega ", "Σ": r"\Sigma ", "Ω": r"\Omega ",
    "…": r"\dots ",
    "■": "",         # MSAM end-of-proof tombstone: chrome, not maths
}

# LMMathExtension10 uses private slots for the pieces of extensible delimiters
# and for the display-size big operators. Only the ones that actually occur on
# the ten pages are mapped; anything else is dropped rather than guessed at.
EXTENSION_LATEX = {
    "\x00": r"\left(", "\x01": r"\right)",
    "\x02": r"\left[", "\x03": r"\right]",
    "\x12": r"\left(", "\x13": r"\right)",
    "\x0c": r"\left|",
    "X": r"\sum",      # the CMEX display sum renders as the glyph 'X'
    "Z": r"\int",
}


def glyphs_to_latex(text: str, font: str) -> str:
    if "Extension" in font:
        return "".join(EXTENSION_LATEX.get(ch, "") for ch in text)
    out = []
    for ch in text:
        if ch in GLYPH_LATEX:
            out.append(GLYPH_LATEX[ch])
        elif ord(ch) > 126 and unicodedata.category(ch).startswith(("S", "P")):
            out.append("")  # an unmapped symbol is dropped, never invented
        else:
            out.append(ch)
    return "".join(out)


def line_to_latex(line: dict) -> str:
    """
    Reconstruct one line of maths, recovering super/subscripts from geometry.

    A LaTeX superscript is set ~0.36em above the baseline at ~70% of the body
    size; a subscript ~0.2em below. So a span whose size is clearly smaller than
    the line's body size and whose baseline is displaced is a script, and which
    kind it is falls straight out of the sign of the displacement. This is the
    one piece of real structure the text layer still carries, and it is the
    difference between `an-ibi` and `a^{n-i}b^{i}`.
    """
    spans = [s for s in line["spans"] if s["text"].strip()]
    if not spans:
        return ""
    body_size = max(s["size"] for s in spans)
    baseline = max(s["origin"][1] for s in spans)

    out: list[str] = []
    mode: str | None = None  # None | "sup" | "sub"
    for s in spans:
        piece = glyphs_to_latex(normalise(s["text"]), s["font"])
        if not piece:
            continue
        small = s["size"] < body_size * 0.85
        dy = s["origin"][1] - baseline
        want: str | None = None
        if small and dy < -0.12 * body_size:
            want = "sup"
        elif small and dy > 0.12 * body_size:
            want = "sub"
        if want != mode:
            if mode is not None:
                out.append("}")
            if want == "sup":
                out.append("^{")
            elif want == "sub":
                out.append("_{")
            mode = want
        out.append(piece)
    if mode is not None:
        out.append("}")
    return re.sub(r"\s+", " ", "".join(out)).strip()


# ── Text assembly ────────────────────────────────────────────────────────────

# LMMathExtension10 addresses the pieces of extensible delimiters by private
# codepoint, so the raw text layer hands back "\x12n i\x13" for a binomial
# coefficient. Left as-is those control characters ride into the selectable
# text and into the clipboard as invisible junk.
EXTENSION_TEXT = {
    "\x00": "(", "\x01": ")", "\x02": "[", "\x03": "]",
    "\x12": "(", "\x13": ")", "\x0c": "|",
    "X": "∑", "Z": "∫",
}


def line_text(line: dict) -> str:
    out = []
    for s in line["spans"]:
        t = s["text"]
        if "Extension" in s["font"]:
            t = "".join(EXTENSION_TEXT.get(ch, "" if ord(ch) < 32 else ch) for ch in t)
        else:
            t = "".join(ch for ch in t if ord(ch) >= 32 or ch in "\t")
        out.append(t)
    return normalise("".join(out))


def join_lines(lines: list[str]) -> str:
    """
    Join wrapped lines, undoing LaTeX's hyphenation.

    "matema-" + "tikeren" is one word broken across a line; "topp- og
    bunnpunkter" is a real hyphen that must survive. The tell is the next
    line's first character: a continuation starts lower-case.
    """
    out = ""
    for i, raw in enumerate(lines):
        cur = raw.rstrip()
        if not out:
            out = cur
            continue
        if out.endswith("-") and i < len(lines) and cur[:1].islower():
            out = out[:-1] + cur
        else:
            out = out + " " + cur
    return re.sub(r"\s+", " ", out).strip()


def leading_bold_run(line: dict) -> tuple[str, float, str] | None:
    """The run of bold spans at the START of a line: ('1.4.2 Binomialformelen', 10.0, 'bold').

    Taken span-by-span and stopped at the first non-bold span on purpose. The
    book sets an environment heading and the first words of its statement on the
    same line — "3.1.4 Regneregler for komplekse tall Dersom z = a + ib …" — so a
    whole-line read would drag the statement into the concept's name.
    """
    text, size, kind = "", 0.0, ""
    for s in line["spans"]:
        c = span_class(s["font"])
        if c not in ("bold", "bolditalic"):
            break
        if kind and c != kind:
            break
        kind = c
        text += s["text"]
        size = max(size, s["size"])
    text = normalise(text).strip()
    return (text, size, kind) if text else None


def full_bold_run(block: dict) -> str:
    """The bold text of a whole heading block, line by line.

    A heading is one bold run to the eye and several to the extractor: the
    section number and the title are set at a fixed distance apart, which
    PyMuPDF reports as two LINES of the same block, and a chapter title that
    wraps is two more. Reading only the first line named the sections "1.1" and
    "3.3" in the outline.

    Concept headings do NOT go through this, and must not: the book sets an
    environment heading and the opening words of its statement on the same line,
    so for those the run has to stop at the first non-bold span.
    """
    parts = []
    for line in block["lines"]:
        run = leading_bold_run(line)
        if run:
            parts.append(run[0])
    return normalise(" ".join(parts)).strip()


def block_font_profile(block: dict) -> dict[str, int]:
    prof: dict[str, int] = {}
    for line in block["lines"]:
        for s in line["spans"]:
            n = len(s["text"].strip())
            if n:
                prof[span_class(s["font"])] = prof.get(span_class(s["font"]), 0) + n
    return prof


def is_running_head(block: dict, page_height: float) -> bool:
    """The folio line at the top of every body page, and nothing else.

    Pinned to geometry AND font: an 8pt sans line in the top 10% of the page.
    The 8pt sans epigraphs on the chapter-opening pages sit at y≈240 and must
    not be swallowed — they are the page's voice, not its chrome.
    """
    prof = block_font_profile(block)
    if not prof:
        return False
    sans = prof.get("sans", 0) + prof.get("bold", 0)
    if sans < sum(prof.values()) * 0.9:
        return False
    sizes = [s["size"] for l in block["lines"] for s in l["spans"] if s["text"].strip()]
    return bool(sizes) and max(sizes) <= 8.6 and block["bbox"][3] < page_height * 0.10


# ── Figures ──────────────────────────────────────────────────────────────────

CAPTION_RE = re.compile(r"^Figur\s+\d+(?:\.\d+)+\.?\s*$")


def drawing_clusters(page: fitz.Page) -> tuple[list[fitz.Rect], list[fitz.Rect]]:
    """Split the page's vector drawings into (figures, environment frames).

    Every figure in Kalkulus is drawn, never placed as an image (get_images() is
    empty on all ten pages), so a figure's extent is the union of a cluster of
    drawing rects. But so is a LOT of non-figure furniture, and typing it all as
    "figure" put a phantom figure on top of every theorem on the page:

      - the rule under the running head                      (1 stroke)
      - the tinted box Kalkulus draws around every numbered
        environment: 4 edges + 1 fill                        (5 primitives)
      - the full-bleed banner behind a chapter title          (1 fill, and it
        extends outside the page box, which nothing real does)

    A genuine figure is made of many small primitives — the least of the ten is
    figur 3.2.2 at 30, the most is figur 5.0.1 at 203 — so the primitive COUNT
    separates them cleanly with an order of magnitude to spare.

    The frames are not thrown away: returned separately, they are exactly the
    visual extent of the environment they box, which is what makes a concept's
    highlight flash the whole boxed statement instead of just its heading line.
    """
    rects = []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.width < 0.5 and r.height < 0.5:
            continue
        rects.append(r)
    if not rects:
        return [], []

    clusters: list[list] = []  # [rect, primitive count]
    for r in sorted(rects, key=lambda r: (r.y0, r.x0)):
        placed = False
        for c in clusters:
            grown = fitz.Rect(c[0].x0 - 14, c[0].y0 - 14, c[0].x1 + 14, c[0].y1 + 14)
            if grown.intersects(r):
                c[0] = c[0] | r
                c[1] += 1
                placed = True
                break
        if not placed:
            clusters.append([fitz.Rect(r), 1])

    # Proximity is not transitive in one sweep: two rects far apart can both be
    # near a third added later, so keep merging until nothing moves.
    changed = True
    while changed:
        changed = False
        out: list[list] = []
        for c in clusters:
            hit = False
            for o in out:
                if fitz.Rect(o[0].x0 - 14, o[0].y0 - 14, o[0].x1 + 14, o[0].y1 + 14).intersects(c[0]):
                    o[0] = o[0] | c[0]
                    o[1] += c[1]
                    hit = True
                    changed = True
                    break
            if not hit:
                out.append([fitz.Rect(c[0]), c[1]])
        clusters = out

    page_box = fitz.Rect(page.rect)
    figures: list[fitz.Rect] = []
    frames: list[fitz.Rect] = []
    for rect, count in clusters:
        if rect.x0 < page_box.x0 - 1 or rect.x1 > page_box.x1 + 1:
            continue  # bleeds off the page: decoration, never content
        if rect.width * rect.height < 1200 or rect.width <= 25 or rect.height <= 25:
            continue
        (figures if count >= 6 else frames).append(rect)
    return figures, frames


# ── Display maths ────────────────────────────────────────────────────────────

def merge_display_math(blocks: list[dict]) -> list[dict]:
    """Reassemble one display equation out of the fragments PyMuPDF returns.

    A LaTeX display is laid out as independently positioned boxes — the sum
    sign, its limits, the binomial coefficient's two rows, each of its
    delimiters — and the text extractor faithfully reports each as its own
    block. The binomial formula on p.54 arrives as EIGHT of them. Left alone
    that is eight outlines in the data layer over one equation, and eight
    unusable scraps of LaTeX.

    Fragments that touch (within 8px of each other, after expansion) are one
    display. Reading order inside it is by row band and then by x, not by y:
    sorting on y alone puts the sum's upper limit before the "(a+b)^n =" that
    starts the line, because the limit is set higher.
    """
    math = [b for b in blocks if b["type"] == "math"]
    rest = [b for b in blocks if b["type"] != "math"]
    if not math:
        return blocks

    def touches(a: dict, b: dict) -> bool:
        ax0, ay0, ax1, ay1 = a["bbox"]
        bx0, by0, bx1, by1 = b["bbox"]
        return ax0 - 16 < bx1 and bx0 - 16 < ax1 and ay0 - 16 < by1 and by0 - 16 < ay1

    groups: list[list[dict]] = [[b] for b in sorted(math, key=lambda b: (b["bbox"][1], b["bbox"][0]))]
    changed = True
    while changed:  # touching is not transitive in one pass
        changed = False
        for i in range(len(groups)):
            if not groups[i]:
                continue
            for j in range(i + 1, len(groups)):
                if not groups[j]:
                    continue
                if any(touches(a, b) for a in groups[i] for b in groups[j]):
                    groups[i].extend(groups[j])
                    groups[j] = []
                    changed = True
    groups = [g for g in groups if g]

    out = list(rest)
    for g in groups:
        if len(g) == 1:
            out.append(g[0])
            continue
        band = 40.0
        ordered = sorted(g, key=lambda b: (round(b["bbox"][1] / band), b["bbox"][0]))
        out.append({
            "type": "math",
            "bbox": [min(b["bbox"][0] for b in g), min(b["bbox"][1] for b in g),
                     max(b["bbox"][2] for b in g), max(b["bbox"][3] for b in g)],
            "text": " ".join(b["text"] for b in ordered if b["text"].strip()),
            "latex": " ".join(b["latex"] for b in ordered if b.get("latex")),
            "fontSize": max((b.get("fontSize") or 0) for b in g) or None,
        })
    return out


# ── Page numbering ───────────────────────────────────────────────────────────

def printed_page_number(page: fitz.Page, index: int) -> int:
    """The number the book itself prints, read off the folio rather than assumed.

    It happens to equal index + 1 throughout this PDF, but that is a property of
    this scan's front matter, not a rule, and a silently wrong page number on a
    citation is the kind of error nobody catches later.
    """
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        if block["bbox"][3] >= page.rect.height * 0.10:
            continue
        for line in block["lines"]:
            for s in line["spans"]:
                t = s["text"].strip()
                if t.isdigit() and span_class(s["font"]) == "bold" and s["size"] <= 8.6:
                    return int(t)
    return index + 1  # chapter-opening pages print no folio


# ── Extraction ───────────────────────────────────────────────────────────────

def extract_page(doc: fitz.Document, index: int, order: int, note: str, out_dir: str) -> dict:
    page = doc[index]
    printed = printed_page_number(page, index)

    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE))
    image_name = f"p{printed}.png"
    pix.save(os.path.join(out_dir, image_name))

    raw_blocks = [b for b in page.get_text("dict")["blocks"] if b["type"] == 0 and b.get("lines")]
    clusters, frames = drawing_clusters(page)

    blocks: list[dict] = []
    for block in raw_blocks:
        if is_running_head(block, page.rect.height):
            continue
        lines = block["lines"]
        texts = [line_text(l) for l in lines]
        text = join_lines(texts)
        # MSAM's tombstone marks the end of a proof or an example. It is a
        # typographic mark, not content, and on its own it produced a 15px
        # "maths" block in the margin of every worked example.
        if not text.strip() or text.strip() == "■":
            continue

        prof = block_font_profile(block)
        total = max(sum(prof.values()), 1)
        head = leading_bold_run(lines[0])

        sizes = sorted(s["size"] for l in lines for s in l["spans"] if s["text"].strip())
        entry: dict = {
            "bbox": [round(v * SCALE, 1) for v in block["bbox"]],
            "text": text,
            # The block's own glyph size, carried through so the data layer can
            # set its text AT that size and land roughly on top of the printed
            # words instead of floating at some arbitrary CSS default.
            "fontSize": round(sizes[len(sizes) // 2] * SCALE, 1) if sizes else None,
        }

        if head and head[1] >= 20:
            entry["type"], entry["level"], entry["heading"] = "heading", 1, full_bold_run(block)
        elif head and head[1] >= 13:
            entry["type"], entry["level"], entry["heading"] = "heading", 2, full_bold_run(block)
        elif head and head[1] >= 11:
            entry["type"], entry["level"], entry["heading"] = "heading", 3, full_bold_run(block)
        elif head:
            # 10pt bold, or 9pt bold-italic ("Bevis:"): an environment heading.
            # Stage 2 decides what kind of concept it is.
            entry["type"], entry["heading"] = "concept", head[0]
        elif prof.get("math", 0) > total * 0.55:
            entry["type"] = "math"
            entry["latex"] = " \\\\ ".join(
                filter(None, (line_to_latex(l) for l in lines))
            )
        elif CAPTION_RE.match(text):
            entry["type"], entry["label"] = "figure", text.rstrip(".")
        elif re.match(r"^\d{1,2}\.\s", text):
            entry["type"], entry["label"] = "exercise", re.match(r"^(\d{1,2})\.", text).group(1)
        else:
            entry["type"] = "paragraph"

        blocks.append(entry)

    blocks = merge_display_math(blocks)

    # A caption block absorbs the drawing cluster it belongs to, so the figure's
    # box is the drawing plus its caption rather than a caption floating under
    # an unlabelled rectangle.
    for entry in blocks:
        if entry["type"] != "figure":
            continue
        x0, y0, x1, y1 = entry["bbox"]
        for c in list(clusters):
            cb = [c.x0 * SCALE, c.y0 * SCALE, c.x1 * SCALE, c.y1 * SCALE]
            above = cb[3] <= y0 + 8 and y0 - cb[3] < 90
            overlaps = cb[2] > x0 - 120 and cb[0] < x1 + 120
            if above and overlaps:
                entry["bbox"] = [min(x0, cb[0]), min(y0, cb[1]), max(x1, cb[2]), max(y1, cb[3])]
                clusters.remove(c)
                break
        else:
            # figur 1.4.1 and 1.4.2 are set as TYPE, not as drawings — Pascal's
            # triangle is a grid of binomial coefficients — so the thing above
            # the caption is a maths block rather than a cluster.
            above_math = [b for b in blocks
                          if b["type"] == "math" and 0 <= y0 - b["bbox"][3] < 45
                          and b["bbox"][2] > x0 - 200 and b["bbox"][0] < x1 + 200]
            for m in above_math:
                entry["bbox"] = [min(entry["bbox"][0], m["bbox"][0]), min(entry["bbox"][1], m["bbox"][1]),
                                 max(entry["bbox"][2], m["bbox"][2]), max(entry["bbox"][3], m["bbox"][3])]

    # Clusters with no caption are still figures — figur 5.0.1's graph is drawn
    # well above its caption, and several plots in chapter 3 carry none at all.
    for c in clusters:
        blocks.append({
            "type": "figure",
            "bbox": [round(c.x0 * SCALE, 1), round(c.y0 * SCALE, 1),
                     round(c.x1 * SCALE, 1), round(c.y1 * SCALE, 1)],
            "text": "",
        })

    # The tinted frame around a numbered environment IS that environment's
    # extent. Handing it to the concept block is what lets the concept rail
    # flash the whole boxed statement rather than one heading line, and it
    # costs nothing — the frame is already on the page.
    for f in frames:
        fb = [f.x0 * SCALE, f.y0 * SCALE, f.x1 * SCALE, f.y1 * SCALE]
        owner = next((b for b in blocks
                      if b["type"] == "concept"
                      and fb[1] - 6 <= b["bbox"][1] <= fb[3]
                      and fb[0] - 6 <= b["bbox"][0] <= fb[2]), None)
        if owner:
            owner["bbox"] = [min(owner["bbox"][0], fb[0]), min(owner["bbox"][1], fb[1]),
                             max(owner["bbox"][2], fb[2]), max(owner["bbox"][3], fb[3])]

    blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))

    # Chapter openings set the numeral and the title as separate blocks at
    # different sizes; they are one heading.
    merged: list[dict] = []
    for b in blocks:
        prev = merged[-1] if merged else None
        if (prev and b["type"] == "heading" and prev["type"] == "heading"
                and b.get("level") == prev.get("level")
                and b["bbox"][1] - prev["bbox"][3] < 40):
            prev["text"] = f"{prev['text']} {b['text']}".strip()
            prev["heading"] = f"{prev.get('heading', '')} {b.get('heading', '')}".strip()
            prev["bbox"] = [min(prev["bbox"][0], b["bbox"][0]), min(prev["bbox"][1], b["bbox"][1]),
                            max(prev["bbox"][2], b["bbox"][2]), max(prev["bbox"][3], b["bbox"][3])]
        else:
            merged.append(b)

    for i, b in enumerate(merged):
        b["id"] = f"p{printed}-b{i}"
        b["html"] = to_html(b)

    return {
        "n": order,
        "pdfPage": index + 1,
        "printedPage": printed,
        "note": note,
        "image": f"/reader-proto/kalkulus/{image_name}",
        "width": pix.width,
        "height": pix.height,
        "blocks": merged,
    }


def to_html(b: dict) -> str:
    esc = htmllib.escape(b["text"])
    t = b["type"]
    if t == "heading":
        return f"<h{b.get('level', 2)}>{esc}</h{b.get('level', 2)}>"
    if t == "math":
        return f'<div class="rb-math">{esc}</div>'
    if t == "figure":
        return f'<figcaption>{esc}</figcaption>' if esc else '<div class="rb-figure"></div>'
    if t == "exercise":
        return f'<li value="{htmllib.escape(b.get("label", ""))}">{esc}</li>'
    if t == "concept":
        return f'<p class="rb-concept">{esc}</p>'
    return f"<p>{esc}</p>"


# ── Crop ─────────────────────────────────────────────────────────────────────

# Breathing room left either side of the text, in image pixels at SCALE.
CROP_PAD = 18


def assign_crop(pages: list[dict]) -> None:
    """Give every page the same horizontal crop box, tight to the text column.

    Kalkulus is set with a wide inner margin — the text starts about a quarter
    of the way across the sheet — and once the page sits next to a concept rail
    that margin is a gutter between the cue and the thing it names. The crop is
    written into the JSON as a box in IMAGE pixels rather than applied to the
    PNG, so the bboxes stay in the coordinate system they were measured in and
    the reader maps them through the crop at render time. Re-cropping later is
    a number in this file, not a re-render of ten images.

    One box for all ten pages, not one per page. Per-page boxes would be
    tighter, but a page whose widest line is short would then render LARGER
    than its neighbours at the same column width — the book's own type would
    change size from page to page, which is worse than a little slack.

    Vertical extent is left alone: the head and foot margins carry the folio
    and the running head, which are how a page says which page it is.
    """
    x0 = min((b["bbox"][0] for p in pages for b in p["blocks"]), default=0.0)
    x1 = max((b["bbox"][2] for p in pages for b in p["blocks"]), default=0.0)
    for p in pages:
        left = max(0.0, x0 - CROP_PAD)
        right = min(float(p["width"]), x1 + CROP_PAD)
        p["crop"] = [round(left, 1), 0.0, round(right, 1), float(p["height"])]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pdf", default="/Users/bastianthomsen/Desktop/Kalkulus.pdf")
    ap.add_argument("--out", required=True, help="public/reader-proto/kalkulus")
    ap.add_argument("--raw", required=True, help="where stage 2 reads the raw blocks from")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    # dirname of a bare filename is "", and os.makedirs("") raises — a --raw
    # with no directory component means "right here", which already exists.
    raw_dir = os.path.dirname(args.raw)
    if raw_dir:
        os.makedirs(raw_dir, exist_ok=True)

    doc = fitz.open(args.pdf)
    pages = [extract_page(doc, idx, order, note, args.out)
             for order, (idx, note) in enumerate(PAGES)]
    assign_crop(pages)

    payload = {
        "v": 1,
        "title": "Kalkulus",
        "author": "Tom Lindstrøm",
        "source": {
            "pdf": os.path.basename(args.pdf),
            "pdfPages": doc.page_count,
            "extractor": f"PyMuPDF {fitz.pymupdf_version}",
            "renderScale": SCALE,
            # A PDF holds positioned glyphs, not LaTeX. Every `latex` field below
            # is reconstructed from span geometry and a glyph map — good enough
            # to copy and correct, not good enough to trust unread. The reader
            # says so next to the copy button.
            "latexIsTranscribed": True,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "pages": pages,
    }
    with open(args.raw, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    for p in pages:
        kinds: dict[str, int] = {}
        for b in p["blocks"]:
            kinds[b["type"]] = kinds.get(b["type"], 0) + 1
        print(f"  p{p['printedPage']:>4} (pdf {p['pdfPage']})  {kinds}")
    c = pages[0]["crop"]
    print(f"  crop x {c[0]:.0f}–{c[2]:.0f} of {pages[0]['width']} "
          f"({(c[2] - c[0]) / pages[0]['width']:.0%} of the sheet kept)")
    print(f"raw blocks -> {args.raw}")


if __name__ == "__main__":
    main()
