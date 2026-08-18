#!/usr/bin/env python3
"""Generator for bucket `regex-words` — brief.md §C.4.

usage: regex_words.py --seed N --count M [--out drills.jsonl] [--formats mcq,truefalse,tiles,blank]

Grammar: E ::= a | b | ε | E E | (E + E) | (E)*   over Σ = {a,b}, depth <= 3,
<= 10 leaf symbols, at least one * and at least one of +/ε.

Ground truth: translate to a Python regex (course '+' -> '|', 'ε' -> empty
alternative), enumerate ALL 127 words of length <= 6 over {a,b}, partition
via re.fullmatch. No hand-reasoning anywhere in the generator.

Deterministic: numpy.random.default_rng(seed) is the only randomness
source. Every emitted drill is validated with _validate.validate_row.
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _validate import validate_row  # noqa: E402

BUCKET = "regex-words"
COURSE_ID = 3

ALL_WORDS = ["".join(p) for k in range(7) for p in itertools.product("ab", repeat=k)]  # 127 words, len<=6
assert len(ALL_WORDS) == 127

HOW_MD = (
    "1. Rewrite the expression as a sequence of blocks; mark optional (ε/?) and repeating (*) ones.\n"
    "2. Build the SHORTEST accepted word by taking zero repetitions everywhere.\n"
    "3. Build longer ones by pumping one block at a time.\n"
    "4. To reject: break exactly one block's shape (wrong count, wrong letter, wrong position)."
)


def _code(seed: int, i: int) -> str:
    return f"spr-dbms-{BUCKET}-g{seed}-{i:04d}"


def _envelope(difficulty: int) -> dict:
    return {"v": 1, "lens": None, "concept_ids": [], "difficulty": difficulty}


# ---------------------------------------------------------------------------
# Grammar
# ---------------------------------------------------------------------------

def _gen_node(rng: np.random.Generator, depth: int, counter: list[int]):
    if depth <= 0 or counter[0] >= 10:
        return _gen_leaf(rng, counter)
    op = rng.choice(["leaf", "concat", "alt", "star"], p=[0.30, 0.32, 0.20, 0.18])
    if op == "leaf":
        return _gen_leaf(rng, counter)
    if op == "concat":
        return ("concat", _gen_node(rng, depth - 1, counter), _gen_node(rng, depth - 1, counter))
    if op == "alt":
        return ("alt", _gen_node(rng, depth - 1, counter), _gen_node(rng, depth - 1, counter))
    return ("star", _gen_node(rng, depth - 1, counter))


def _gen_leaf(rng: np.random.Generator, counter: list[int]):
    counter[0] += 1
    r = rng.random()
    if r < 0.45:
        return ("leaf", "a")
    if r < 0.90:
        return ("leaf", "b")
    return ("eps",)


def _has_star(node) -> bool:
    if node[0] == "star":
        return True
    if node[0] == "concat" or node[0] == "alt":
        return _has_star(node[1]) or _has_star(node[2])
    return False


def _has_plus_or_eps(node) -> bool:
    if node[0] == "eps":
        return True
    if node[0] == "alt":
        return True
    if node[0] == "concat":
        return _has_plus_or_eps(node[1]) or _has_plus_or_eps(node[2])
    if node[0] == "star":
        return _has_plus_or_eps(node[1])
    return False


def _to_display(node) -> str:
    t = node[0]
    if t == "leaf":
        return node[1]
    if t == "eps":
        return "ε"
    if t == "concat":
        return _to_display(node[1]) + _to_display(node[2])
    if t == "alt":
        return "(" + _to_display(node[1]) + " + " + _to_display(node[2]) + ")"
    return "(" + _to_display(node[1]) + ")*"


def _to_python(node) -> str:
    t = node[0]
    if t == "leaf":
        return node[1]
    if t == "eps":
        return ""
    if t == "concat":
        return _to_python(node[1]) + _to_python(node[2])
    if t == "alt":
        return "(?:" + _to_python(node[1]) + "|" + _to_python(node[2]) + ")"
    return "(?:" + _to_python(node[1]) + ")*"


def _gen_regex_instance(rng: np.random.Generator, seen_signatures: set[frozenset]):
    counter = [0]
    node = _gen_node(rng, depth=3, counter=counter)
    if not (_has_star(node) and _has_plus_or_eps(node)):
        return None
    display = _to_display(node)
    py = _to_python(node)
    try:
        pattern = re.compile(py)
    except re.error:
        return None

    accepted = [w for w in ALL_WORDS if pattern.fullmatch(w)]
    rejected = [w for w in ALL_WORDS if not pattern.fullmatch(w)]

    if len(accepted) < 3 or len(rejected) < 3:
        return None
    if accepted == [""]:
        return None
    signature = frozenset(accepted)
    if signature in seen_signatures:
        return None
    seen_signatures.add(signature)

    difficulty = 1 if counter[0] <= 4 else (2 if counter[0] <= 7 else 3)
    return {"display": display, "accepted": accepted, "rejected": rejected, "difficulty": difficulty}


# ---------------------------------------------------------------------------
# Drill builders
# ---------------------------------------------------------------------------

def _word_disp(w: str) -> str:
    return "ε" if w == "" else w


def _build_mcq(rng, seed, i, inst):
    display = inst["display"]
    mirrored = bool(rng.integers(0, 2))
    if not mirrored:
        target_pool, foil_pool = inst["rejected"], inst["accepted"]
        prompt = f"Which word is **not** accepted by `{display}`?"
        why = f"`{{ans}}` breaks the required shape of `{display}` — the others all fit."
    else:
        target_pool, foil_pool = inst["accepted"], inst["rejected"]
        prompt = f"Which word **is** accepted by `{display}`?"
        why = f"`{{ans}}` matches every block of `{display}`; the others break at least one."

    if len(target_pool) < 1 or len(foil_pool) < 3:
        return None
    target = str(rng.choice(target_pool))
    foils = list(rng.choice(foil_pool, size=3, replace=False))
    choices_vals = [target] + [str(f) for f in foils]
    rng.shuffle(choices_vals)
    answer_idx = choices_vals.index(target)
    why = why.format(ans=_word_disp(target))
    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": prompt,
        "why_md": why,
        "how_md": HOW_MD,
        "tip_md": "Zero repetitions of `*` is always legal — check the empty case first.",
        "choices": [_word_disp(v) for v in choices_vals],
        "answer_idx": answer_idx,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "mcq", "content": content,
            "status": "draft", "authored_by": f"generator:regex_words.py@{seed}"}


def _build_truefalse(rng, seed, i, inst, want_true: bool):
    display = inst["display"]
    pool = inst["accepted"] if want_true else inst["rejected"]
    if not pool:
        return None
    word = str(rng.choice(pool))
    statement = f"`{_word_disp(word)}` is accepted by `{display}`."
    if want_true:
        why = f"`{_word_disp(word)}` decomposes cleanly into `{display}`'s blocks."
    else:
        why = f"`{_word_disp(word)}` breaks at least one block of `{display}` — no valid decomposition exists."
    content = {
        **_envelope(inst["difficulty"]),
        "statement_md": statement,
        "why_md": why,
        "how_md": HOW_MD,
        "tip_md": "Scan left to right against the blocks, consuming greedily then backtracking.",
        "answer": want_true,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "truefalse", "content": content,
            "status": "draft", "authored_by": f"generator:regex_words.py@{seed}"}


def _build_tiles(rng, seed, i, inst):
    display = inst["display"]
    if len(inst["accepted"]) < 3 or len(inst["rejected"]) < 3:
        return None
    acc = list(rng.choice(inst["accepted"], size=3, replace=False))
    rej = list(rng.choice(inst["rejected"], size=3, replace=False))
    words = [str(w) for w in acc] + [str(w) for w in rej]
    rng.shuffle(words)
    tiles = [{"id": f"t{k+1}", "md": _word_disp(w), "correct": w in acc} for k, w in enumerate(words)]
    if any(len(t["md"]) > 24 for t in tiles):
        return None
    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": f"Tap every word accepted by `{display}`.",
        "why_md": "Exactly the words that decompose into the expression's blocks with zero leftover characters are accepted.",
        "how_md": HOW_MD,
        "tip_md": "Check the shortest candidates first — they expose whether ε/`*` at zero reps applies.",
        "mode": "select",
        "tiles": tiles,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "tiles", "content": content,
            "status": "draft", "authored_by": f"generator:regex_words.py@{seed}"}


def _build_blank(rng, seed, i, inst):
    display = inst["display"]
    shortest = min(inst["accepted"], key=len)
    if shortest == "":
        accept = ["ε", "", "epsilon", "empty", "empty string"]
        placeholder = "e.g. ε or (empty)"
    else:
        accept = [shortest]
        placeholder = "e.g. ab"
    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": f"Shortest word accepted by `{display}`? ___",
        "why_md": f"Taking zero repetitions of every `*` block yields `{_word_disp(shortest)}`, the minimal accepted word.",
        "how_md": HOW_MD,
        "tip_md": "The shortest accepted word always comes from zero repetitions everywhere, never from picking a bigger branch.",
        "accept": accept,
        "accept_mode": "exact",
        "placeholder": placeholder,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "blank", "content": content,
            "status": "draft", "authored_by": f"generator:regex_words.py@{seed}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--out", type=str, default=None)
    ap.add_argument("--formats", type=str, default="mcq,truefalse,tiles,blank")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    formats = args.formats.split(",")

    out_rows: list[dict] = []
    attempts = 0
    max_attempts = 50 * args.count
    seen_signatures: set[frozenset] = set()
    fmt_idx = 0
    true_count = 0
    false_count = 0

    while len(out_rows) < args.count and attempts < max_attempts:
        attempts += 1
        inst = _gen_regex_instance(rng, seen_signatures)
        if inst is None:
            continue

        fmt = formats[fmt_idx % len(formats)]
        fmt_idx += 1

        row = None
        if fmt == "mcq":
            row = _build_mcq(rng, args.seed, len(out_rows) + 1, inst)
        elif fmt == "truefalse":
            want_true = true_count <= false_count
            row = _build_truefalse(rng, args.seed, len(out_rows) + 1, inst, want_true)
            if row is not None:
                if want_true:
                    true_count += 1
                else:
                    false_count += 1
        elif fmt == "tiles":
            row = _build_tiles(rng, args.seed, len(out_rows) + 1, inst)
        elif fmt == "blank":
            row = _build_blank(rng, args.seed, len(out_rows) + 1, inst)

        if row is None:
            continue
        errs = validate_row(row)
        if errs:
            continue
        out_rows.append(row)

    if len(out_rows) < args.count:
        print(f"regex_words.py: only produced {len(out_rows)}/{args.count} after {attempts} attempts",
              file=sys.stderr)
        return 1

    text = "\n".join(json.dumps(r) for r in out_rows)
    if args.out:
        Path(args.out).write_text(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
