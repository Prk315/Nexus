#!/usr/bin/env python3
"""Generator for bucket `ra-write` — not in brief.md §C (only fd-closure-keys,
bcnf-normalization, evaluation-cost, regex-words are specified there), but
`ra-write` landed at 9/22 drills after verification and needs volume to
clear the 12-drill floor, so it follows the same §C.0 contract.

usage: ra_write.py --seed N --count M [--out drills.jsonl] [--formats mcq,tiles,why]

Two templates, both over a fixed tiny synthetic schema so tile text stays
inside the 24-char chip budget (this is exactly the trap that killed 13/22
authored ra-write drills — long realistic names like `Attends`/`courseID`
blow the tile limit):

  R(K,A,B)                  -- single-relation select+project
  R(K,A,B), S(K,C,D)        -- two-relation join+select+project, K shared

The classic wrong path this generator isolates is bucket 5's own #3:
"Projecting before a selection that needs the projected-away attribute."
Every condition attribute is deliberately excluded from the target
projection, so swapping σ/π order is a genuine, checkable bug — not just a
style difference.

Ground truth is never asserted by construction. A tiny RA interpreter
(`_run`) executes each candidate's operator sequence against concrete
sample rows; the "correct" choice's result is compared against an
INDEPENDENTLY computed expected set (plain Python filter/project, not
built from the same op-sequence machinery), and every distractor is
confirmed to either raise (attribute no longer present -- semantically
invalid, the exact bug being taught) or produce a different result set.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _validate import validate_row  # noqa: E402

BUCKET = "ra-write"
COURSE_ID = 3
LENS = "ra"

HOW_MD = (
    "1. List the relations you need, joined on shared keys (⋈).\n"
    "2. Apply σ as early as it is legal (push selections down).\n"
    "3. π LAST, to exactly the requested columns — never before a σ that needs a column you're about to drop."
)


def _code(seed: int, i: int) -> str:
    return f"spr-dbms-{BUCKET}-g{seed}-{i:04d}"


def _envelope(difficulty: int) -> dict:
    return {"v": 1, "lens": LENS, "concept_ids": [], "difficulty": difficulty}


# ---------------------------------------------------------------------------
# Tiny RA interpreter — self-verification only, never used to author the answer
# ---------------------------------------------------------------------------

def _cmp(a, op, b):
    if op == ">":
        return a > b
    if op == "<":
        return a < b
    if op == ">=":
        return a >= b
    if op == "=":
        return a == b
    if op == "≠":
        return a != b
    raise ValueError(op)


def _run(ops, rows):
    """ops in EXECUTION order (index 0 applied first / innermost). Raises
    KeyError if a later op references an attribute a prior projection
    already dropped — that IS the bug the wrong-order distractors encode."""
    cur = rows
    for op in ops:
        if op[0] == "select":
            _, attr, cmp_, val = op
            cur = [r for r in cur if _cmp(r[attr], cmp_, val)]
        elif op[0] == "project":
            _, attrs = op
            seen = set()
            out = []
            for r in cur:
                t = tuple(r[a] for a in attrs)  # KeyError if attr was dropped
                if t not in seen:
                    seen.add(t)
                    out.append(dict(zip(attrs, t)))
            cur = out
        elif op[0] == "join":
            _, other_rows, key = op
            idx = {r[key]: r for r in other_rows}
            out = []
            for r in cur:
                if r[key] in idx:
                    merged = dict(r)
                    merged.update(idx[r[key]])
                    out.append(merged)
            cur = out
    return cur


def _render(ops) -> str:
    text = "R"
    for op in ops:
        if op[0] == "select":
            _, attr, cmp_, val = op
            text = f"σ{attr}{cmp_}{val}({text})"
        elif op[0] == "project":
            _, attrs = op
            text = f"π{','.join(attrs)}({text})"
        elif op[0] == "join":
            text = f"{text} ⋈ S"
    return text


def _result_set(rows):
    return frozenset(tuple(sorted(r.items())) for r in rows)


# ---------------------------------------------------------------------------
# Template A: single relation R(K,A,B) — filter + project
# ---------------------------------------------------------------------------

A_POOL = ["p", "q", "r", "s"]


def _gen_filter_instance(rng: np.random.Generator):
    n = int(rng.integers(4, 7))
    R = []
    for k in range(1, n + 1):
        R.append({"K": k, "A": str(rng.choice(A_POOL)), "B": int(rng.integers(1, 10))})

    numeric = bool(rng.integers(0, 2))
    if numeric:
        v = int(rng.integers(2, 9))
        cond_attr, cmp_op, val = "B", ">", v
        proj_attrs = ["K", "A"]
        wrong_cmp = "<"
    else:
        x = str(rng.choice(A_POOL))
        cond_attr, cmp_op, val = "A", "=", x
        proj_attrs = ["K", "B"]
        wrong_cmp = "≠"

    n_pass = sum(1 for r in R if _cmp(r[cond_attr], cmp_op, val))
    if n_pass == 0 or n_pass == len(R):
        return None  # degenerate: filter has no discriminating effect

    correct_ops = [("select", cond_attr, cmp_op, val), ("project", proj_attrs)]
    got = _result_set(_run(correct_ops, R))
    # Independent computation (plain filter/project, not the _run machinery) is the ground truth.
    expected = {tuple(r[a] for a in proj_attrs) for r in R if _cmp(r[cond_attr], cmp_op, val)}
    expected_rows = [dict(zip(proj_attrs, t)) for t in sorted(expected)]
    if _result_set(expected_rows) != got:
        return None  # independent computation disagrees with the interpreter — reject, don't trust construction

    bad_order_ops = [("project", proj_attrs), ("select", cond_attr, cmp_op, val)]
    wrong_cmp_ops = [("select", cond_attr, wrong_cmp, val), ("project", proj_attrs)]

    try:
        _run(bad_order_ops, R)
        bad_order_valid = True
    except KeyError:
        bad_order_valid = False
    if bad_order_valid:
        return None  # the trap only teaches if the bad order is actually invalid here

    wrong_cmp_result = _result_set(_run(wrong_cmp_ops, R))
    if wrong_cmp_result == got:
        return None  # distractor accidentally equivalent

    return {
        "kind": "filter",
        "R": R,
        "cond_attr": cond_attr,
        "cmp_op": cmp_op,
        "val": val,
        "wrong_cmp": wrong_cmp,
        "proj_attrs": proj_attrs,
        "correct_ops": correct_ops,
        "bad_order_ops": bad_order_ops,
        "wrong_cmp_ops": wrong_cmp_ops,
        "difficulty": 1,
    }


# ---------------------------------------------------------------------------
# Template B: R(K,A,B) ⋈ S(K,C,D) — join + filter + project
# ---------------------------------------------------------------------------

C_POOL = ["x", "y", "z"]


def _gen_join_instance(rng: np.random.Generator):
    n = int(rng.integers(4, 7))
    R = [{"K": k, "A": str(rng.choice(A_POOL)), "B": int(rng.integers(1, 10))} for k in range(1, n + 1)]
    S = [{"K": k, "C": str(rng.choice(C_POOL)), "D": int(rng.integers(1, 10))} for k in range(1, n + 1)]

    numeric = bool(rng.integers(0, 2))
    if numeric:
        v = int(rng.integers(2, 9))
        cond_attr, cmp_op, val = "D", ">", v
        proj_attrs = ["K", "A", "C"]
        wrong_cmp = "<"
    else:
        x = str(rng.choice(C_POOL))
        cond_attr, cmp_op, val = "C", "=", x
        proj_attrs = ["K", "A", "D"]
        wrong_cmp = "≠"

    joined = _run([("join", S, "K")], R)
    n_pass = sum(1 for r in joined if _cmp(r[cond_attr], cmp_op, val))
    if n_pass == 0 or n_pass == len(joined):
        return None

    correct_ops = [("join", S, "K"), ("select", cond_attr, cmp_op, val), ("project", proj_attrs)]
    got = _result_set(_run(correct_ops, R))
    expected = {tuple(r[a] for a in proj_attrs) for r in joined if _cmp(r[cond_attr], cmp_op, val)}
    expected_rows = [dict(zip(proj_attrs, t)) for t in sorted(expected)]
    if _result_set(expected_rows) != got:
        return None

    forgot_join_ops = [("select", cond_attr, cmp_op, val), ("project", proj_attrs)]
    bad_order_ops = [("join", S, "K"), ("project", proj_attrs), ("select", cond_attr, cmp_op, val)]
    wrong_cmp_ops = [("join", S, "K"), ("select", cond_attr, wrong_cmp, val), ("project", proj_attrs)]

    for bad_ops in (forgot_join_ops, bad_order_ops):
        try:
            _run(bad_ops, R)
            return None  # should have raised KeyError (attr not present yet / dropped)
        except KeyError:
            pass

    wrong_cmp_result = _result_set(_run(wrong_cmp_ops, R))
    if wrong_cmp_result == got:
        return None

    return {
        "kind": "join",
        "R": R,
        "S": S,
        "cond_attr": cond_attr,
        "cmp_op": cmp_op,
        "val": val,
        "wrong_cmp": wrong_cmp,
        "proj_attrs": proj_attrs,
        "correct_ops": correct_ops,
        "forgot_join_ops": forgot_join_ops,
        "bad_order_ops": bad_order_ops,
        "wrong_cmp_ops": wrong_cmp_ops,
        "difficulty": 2,
    }


# ---------------------------------------------------------------------------
# Drill builders
# ---------------------------------------------------------------------------

def _schema_line(inst) -> str:
    if inst["kind"] == "filter":
        return "R(K,A,B)"
    return "R(K,A,B), S(K,C,D)  -- join on K"


def _prompt_txt(inst) -> str:
    ca, op, val = inst["cond_attr"], inst["cmp_op"], inst["val"]
    proj = ",".join(inst["proj_attrs"])
    if inst["kind"] == "filter":
        return f"Build the RA expression: {proj} where {ca}{op}{val} in R."
    return f"Build the RA expression: {proj} where {ca}{op}{val} in R⋈S."


def _build_tiles(rng, seed, i, inst):
    correct_text = _render(inst["correct_ops"])
    tiles_info = []  # (id, md, is_in_sequence)
    # π tile
    tiles_info.append(("π" + ",".join(inst["proj_attrs"])))
    # σ tile(s)
    tiles_info.append(f"σ{inst['cond_attr']}{inst['cmp_op']}{inst['val']}")
    if inst["kind"] == "join":
        tiles_info.append("R ⋈ S")
    else:
        tiles_info.append("R")

    sequence_mds = list(tiles_info)  # in outer->inner reading order

    distractors = [f"σ{inst['cond_attr']}{inst['wrong_cmp']}{inst['val']}"]
    wrong_proj_pool = [a for a in ["K", "A", "B", "C", "D"] if a not in inst["proj_attrs"]]
    if wrong_proj_pool:
        distractors.append("π" + ",".join(sorted(set(inst["proj_attrs"][:1] + wrong_proj_pool[:1]))))
    else:
        distractors.append("πK")
    if inst["kind"] == "join":
        distractors.append("R × S")
    else:
        distractors.append("σK>0")

    all_mds = sequence_mds + distractors
    if any(len(m) > 24 for m in all_mds):
        return None
    if len(all_mds) < 4 or len(all_mds) > 8:
        return None
    if len(set(all_mds)) != len(all_mds):
        return None  # duplicate tile text would corrupt the id_by_md lookup below

    ids = [f"t{k+1}" for k in range(len(all_mds))]
    order = list(range(len(all_mds)))
    rng.shuffle(order)
    tiles = [{"id": ids[k], "md": all_mds[pos]} for k, pos in enumerate(order)]
    id_by_md = {}
    for t in tiles:
        id_by_md.setdefault(t["md"], t["id"])
    sequence = [id_by_md[m] for m in sequence_mds]

    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": _prompt_txt(inst),
        "why_md": f"σ must run before π drops `{inst['cond_attr']}` — projecting first makes the filter attribute unavailable.",
        "how_md": HOW_MD,
        "tip_md": "π last, always — if the σ you need comes after π in the tile order, you've dropped the column first.",
        "mode": "build",
        "tiles": tiles,
        "sequence": sequence,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "tiles", "content": content,
            "status": "draft", "authored_by": f"generator:ra_write.py@{seed}"}


def _build_mcq(rng, seed, i, inst):
    correct_text = _render(inst["correct_ops"])
    choices_ops = [inst["correct_ops"]]
    if inst["kind"] == "filter":
        choices_ops.append(inst["bad_order_ops"])
        choices_ops.append(inst["wrong_cmp_ops"])
    else:
        choices_ops.append(inst["forgot_join_ops"])
        choices_ops.append(inst["bad_order_ops"])
        choices_ops.append(inst["wrong_cmp_ops"])

    choice_texts = [_render(ops) for ops in choices_ops]
    if len(set(choice_texts)) != len(choice_texts):
        return None
    if any(len(t) > 90 for t in choice_texts):
        return None

    order = list(range(len(choice_texts)))
    rng.shuffle(order)
    choices = [choice_texts[k] for k in order]
    answer_idx = order.index(0)

    if inst["kind"] == "filter":
        why = f"`{inst['cond_attr']}` is filtered but not projected — the selection must run before π drops it."
    else:
        why = "The join must happen first (the condition and target columns live across both relations), σ before π."

    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": _prompt_txt(inst) + " Which RA is correct?",
        "why_md": why,
        "how_md": HOW_MD,
        "tip_md": "π last, always — if σ needs a column π already dropped, the expression is broken, not just inefficient.",
        "choices": choices,
        "answer_idx": answer_idx,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "mcq", "content": content,
            "status": "draft", "authored_by": f"generator:ra_write.py@{seed}"}


def _build_why(rng, seed, i, inst):
    if inst["kind"] != "filter":
        return None
    correct_text = _render(inst["correct_ops"])
    given = f"{_schema_line(inst)}. Correct: {correct_text}"
    choices = [
        f"{inst['cond_attr']} is needed by σ but isn't in the π column list, so σ must run first.",
        "π and σ always commute, so the order never matters.",
        "σ is always written closer to the base relation than π, by convention only.",
        "Both orders cost the same number of operations, so this is a style choice.",
    ]
    answer_idx = 0
    content = {
        **_envelope(inst["difficulty"]),
        "prompt_md": "Why does σ have to come before π here?",
        "given_md": given,
        "why_md": f"After π drops `{inst['cond_attr']}`, no later σ can filter on it — the column is simply gone.",
        "how_md": HOW_MD,
        "tip_md": "If σ's attribute isn't in π's column list, σ must run first — no exceptions.",
        "choices": choices,
        "answer_idx": answer_idx,
    }
    return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
            "source_slug": None, "format": "why", "content": content,
            "status": "draft", "authored_by": f"generator:ra_write.py@{seed}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--out", type=str, default=None)
    ap.add_argument("--formats", type=str, default="mcq,tiles,why")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    formats = args.formats.split(",")

    out_rows: list[dict] = []
    attempts = 0
    max_attempts = 50 * args.count
    fmt_idx = 0

    while len(out_rows) < args.count and attempts < max_attempts:
        attempts += 1
        kind = "filter" if bool(rng.integers(0, 2)) else "join"
        inst = _gen_filter_instance(rng) if kind == "filter" else _gen_join_instance(rng)
        if inst is None:
            continue

        fmt = formats[fmt_idx % len(formats)]
        fmt_idx += 1

        row = None
        if fmt == "tiles":
            row = _build_tiles(rng, args.seed, len(out_rows) + 1, inst)
        elif fmt == "mcq":
            row = _build_mcq(rng, args.seed, len(out_rows) + 1, inst)
        elif fmt == "why":
            row = _build_why(rng, args.seed, len(out_rows) + 1, inst)

        if row is None:
            continue
        errs = validate_row(row)
        if errs:
            continue
        out_rows.append(row)

    if len(out_rows) < args.count:
        print(f"ra_write.py: only produced {len(out_rows)}/{args.count} after {attempts} attempts",
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
