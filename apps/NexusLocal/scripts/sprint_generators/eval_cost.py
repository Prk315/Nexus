#!/usr/bin/env python3
"""Generator for bucket `evaluation-cost` — brief.md §C.3.

Two independent sub-generators behind one CLI:
  --kind cardinality  -- conjunctive-query cardinality (ex2-6 shape)
  --kind btree        -- B+ tree insertion/split cost (ex2-5 shape, restated inline)

usage: eval_cost.py --seed N --count M --kind cardinality|btree [--out drills.jsonl] [--formats mcq,blank]

Deterministic: numpy.random.default_rng(seed) is the only randomness source.
Every emitted drill is validated with _validate.validate_row before being
written; the generator exits nonzero (no output) if it cannot fill the
quota within 50*count attempts.
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _validate import validate_row  # noqa: E402

BUCKET = "evaluation-cost"
COURSE_ID = 3

HOW_MD_CARD = (
    "1. Cardinality: for each tuple of the first atom, count matching tuples of the next. Sum, don't multiply.\n"
    "2. Add each further atom as a FILTER on the partial results — the count can only shrink.\n"
    "3. Projection: if the query asks for a projection, dedupe before counting."
)
HOW_MD_BTREE = (
    "1. B+ tree: insert into the leaf; if it overflows, split, PROMOTE the separator, and repeat upward.\n"
    "2. A split can cascade all the way to a new root.\n"
    "3. Cost: pages = ceil(rows / rows-per-page); a full scan reads all of them regardless of the predicate."
)


def _code(seed: int, i: int) -> str:
    return f"spr-dbms-{BUCKET}-g{seed}-{i:04d}"


def _envelope(difficulty: int) -> dict:
    return {
        "v": 1,
        "lens": None,
        "concept_ids": [],
        "difficulty": difficulty,
    }


# ---------------------------------------------------------------------------
# --kind cardinality
# ---------------------------------------------------------------------------

def _gen_cardinality_instance(rng: np.random.Generator):
    """Returns (pattern, R, S, T_or_None, answer, distractors) or None if degenerate."""
    pattern = rng.choice(["join2", "join3", "semijoin", "negation"])

    H = 2  # number of hub x values — kept small so the printed relations stay scannable
    f = int(rng.choice([2, 3]))  # fanout per x
    c = int(rng.choice([2, 3]))  # spoke chain length per y

    xs = [f"x{i+1}" for i in range(H)]
    y_pool = [f"y{i+1}" for i in range(f + 1)]
    z_pool = [f"z{i+1}" for i in range(c + 1)]

    R = set()
    for x in xs:
        ys = rng.choice(y_pool, size=min(f, len(y_pool)), replace=False)
        for y in ys:
            R.add((x, str(y)))

    y_used = sorted({y for _, y in R})
    S = set()
    for y in y_used:
        zs = rng.choice(z_pool, size=min(c, len(z_pool)), replace=False)
        for z in zs:
            S.add((y, str(z)))

    # Brute-force R JOIN S on shared y (natural join count == |{(x,y,z)}|).
    rs_join = {(x, y, z) for (x, y) in R for (yy, z) in S if yy == y}
    join2 = len(rs_join)

    if pattern == "join2":
        answer = join2
        if answer == 0 or answer > 60:
            return None
        distractors = sorted({len(R) * len(S), len(R) + len(S), len(R), len(S)} - {answer})
        return ("join2", R, S, None, answer, distractors, {"H": H, "f": f, "c": c})

    if pattern == "join3":
        xz_pairs = sorted({(x, z) for (x, _, z) in rs_join})
        if len(xz_pairs) < 4:
            return None
        keep = rng.choice(len(xz_pairs), size=max(1, len(xz_pairs) // 2), replace=False)
        T = {xz_pairs[i] for i in keep}
        rst_join = {(x, y, z) for (x, y, z) in rs_join if (x, z) in T}
        answer = len(rst_join)
        if answer == 0 or answer > 60 or answer == join2:
            return None
        distractors = sorted({join2, len(R) * len(S), len(R) + len(S), len(T)} - {answer})
        return ("join3", R, S, T, answer, distractors, {"H": H, "f": f, "c": c})

    if pattern == "semijoin":
        s_ys = {y for y, _ in S}
        proj = {(x, y) for (x, y) in R if y in s_ys}
        answer = len(proj)
        pre_dedupe = join2  # count before projecting z away / deduping
        if answer == 0 or answer > 60 or answer == len(R):
            return None
        distractors = sorted({pre_dedupe, len(R) * len(S), len(R) + len(S)} - {answer})
        return ("semijoin", R, S, None, answer, distractors, {"H": H, "f": f, "c": c})

    # negation: R(x,y) AND NOT S(y,z), z ranging over the active domain of S.z
    z_active = sorted({z for _, z in S})
    total = len(R) * len(z_active)
    matches = sum(1 for (x, y) in R for z in z_active if (y, z) in S)
    answer = total - matches
    if matches == 0 or matches == total or answer == 0 or answer > 60:
        return None
    distractors = sorted({total, matches, len(R) * len(S), len(R) + len(S)} - {answer})
    return ("negation", R, S, None, answer, distractors, {"H": H, "f": f, "c": c})


def _fmt_pairs(rel: set) -> str:
    return "{" + ", ".join(f"({a},{b})" for a, b in sorted(rel)) + "}"


def _build_cardinality_drill(rng, seed, i, fmt, instance):
    pattern, R, S, T, answer, distractors, params = instance
    distractors = [d for d in distractors if d != answer]
    if len(distractors) < 3:
        return None
    distractors = list(rng.choice(distractors, size=min(3, len(distractors)), replace=False))
    distractors = [int(d) for d in distractors]

    if pattern == "join2":
        query_txt = "R(x,y) ∧ S(y,z)"
        given = f"R = {_fmt_pairs(R)}\nS = {_fmt_pairs(S)}"
        why = "Each R-tuple's y matched against every S-tuple sharing that y — sum the matches per tuple, don't multiply |R|·|S|."
    elif pattern == "join3":
        query_txt = "R(x,y) ∧ S(y,z) ∧ T(x,z)"
        given = f"R = {_fmt_pairs(R)}\nS = {_fmt_pairs(S)}\nT = {_fmt_pairs(T)}"
        why = "T(x,z) is a THIRD filter on the R⋈S result — it can only shrink the two-way join count, never grow it."
    elif pattern == "semijoin":
        query_txt = "∃z. R(x,y) ∧ S(y,z)"
        given = f"R = {_fmt_pairs(R)}\nS = {_fmt_pairs(S)}"
        why = "z is projected away and existentially bound — count DISTINCT (x,y) pairs with a matching y in S, not raw join triples."
    else:
        query_txt = "R(x,y) ∧ ¬S(y,z)"
        given = f"R = {_fmt_pairs(R)}\nS = {_fmt_pairs(S)}"
        why = "Negation ranges over the active domain of z (S's z-values): count = |R|×|dom(z)| minus the (x,y,z) that DO match S."

    tip = "Sum matches per tuple; a negated atom filters against the active domain, it never adds rows."
    prompt = f"Count the result of: {query_txt}"

    if fmt == "blank":
        content = {
            **_envelope(2 if len(R) + len(S) <= 20 else 3),
            "prompt_md": f"```text\n{given}\n```\n{prompt}. Answer: ___",
            "why_md": why,
            "how_md": HOW_MD_CARD,
            "tip_md": tip,
            "accept": [str(answer)],
            "accept_mode": "numeric",
            "placeholder": "e.g. 12",
        }
        return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
                "source_slug": None, "format": "blank", "content": content,
                "status": "draft", "authored_by": f"generator:eval_cost.py@{seed}"}

    if fmt == "mcq":
        choices_vals = distractors[:3] + [answer]
        choices_vals = list(dict.fromkeys(choices_vals))  # dedupe preserving order
        if len(choices_vals) < 4:
            return None
        rng.shuffle(choices_vals)
        answer_idx = choices_vals.index(answer)
        content = {
            **_envelope(2 if len(R) + len(S) <= 20 else 3),
            "prompt_md": f"```text\n{given}\n```\n{prompt}",
            "why_md": why,
            "how_md": HOW_MD_CARD,
            "tip_md": tip,
            "choices": [str(v) for v in choices_vals],
            "answer_idx": answer_idx,
        }
        return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
                "source_slug": None, "format": "mcq", "content": content,
                "status": "draft", "authored_by": f"generator:eval_cost.py@{seed}"}

    return None


# ---------------------------------------------------------------------------
# --kind btree
# ---------------------------------------------------------------------------

def _new_leaf():
    return {"type": "leaf", "keys": []}


def _find_path(root, key):
    path = [root]
    node = root
    while node["type"] != "leaf":
        idx = 0
        while idx < len(node["keys"]) and key >= node["keys"][idx]:
            idx += 1
        node = node["children"][idx]
        path.append(node)
    return path


def _insert(tree_ref, key, d):
    path = _find_path(tree_ref["root"], key)
    leaf = path[-1]
    if key in leaf["keys"]:
        return None  # already present
    leaf["keys"] = sorted(leaf["keys"] + [key])

    splits = 0
    node = leaf
    idx = len(path) - 1
    while len(node["keys"]) > 2 * d:
        mid = len(node["keys"]) // 2
        if node["type"] == "leaf":
            left_keys, right_keys = node["keys"][:mid], node["keys"][mid:]
            sep = right_keys[0]
            new_node = {"type": "leaf", "keys": right_keys}
            node["keys"] = left_keys
        else:
            left_keys = node["keys"][:mid]
            sep = node["keys"][mid]
            right_keys = node["keys"][mid + 1:]
            left_children = node["children"][:mid + 1]
            right_children = node["children"][mid + 1:]
            new_node = {"type": "internal", "keys": right_keys, "children": right_children}
            node["keys"] = left_keys
            node["children"] = left_children
        splits += 1
        idx -= 1
        if idx < 0:
            tree_ref["root"] = {"type": "internal", "keys": [sep], "children": [node, new_node]}
            break
        parent = path[idx]
        pos = 0
        while pos < len(parent["keys"]) and sep >= parent["keys"][pos]:
            pos += 1
        parent["keys"] = parent["keys"][:pos] + [sep] + parent["keys"][pos:]
        parent["children"] = parent["children"][:pos + 1] + [new_node] + parent["children"][pos + 1:]
        node = parent
    return splits


def _height(node):
    if node["type"] == "leaf":
        return 1
    return 1 + max(_height(c) for c in node["children"])


def _render(node):
    if node["type"] == "leaf":
        return "[" + ",".join(str(k) for k in node["keys"]) + "]"
    return "[" + ",".join(str(k) for k in node["keys"]) + " | " + " ".join(_render(c) for c in node["children"]) + "]"


def _leaves(node):
    if node["type"] == "leaf":
        return [node]
    out = []
    for c in node["children"]:
        out.extend(_leaves(c))
    return out


def _gen_btree_instance(rng: np.random.Generator):
    d = int(rng.choice([2, 3]))
    tree_ref = {"root": _new_leaf()}
    pool = list(rng.choice(np.arange(10, 99), size=30, replace=False))
    pool = [int(x) for x in pool]
    n_initial = int(rng.integers(5, 10))
    used = set()
    for k in pool[:n_initial]:
        _insert(tree_ref, k, d)
        used.add(k)
    if _height(tree_ref["root"]) > 3:
        return None
    if not any(len(leaf["keys"]) >= d for leaf in _leaves(tree_ref["root"])):
        return None  # no leaf half-full: no insertion can ever split

    n_test = int(rng.integers(1, 4))  # 1..3 further insertions
    remaining = [k for k in pool[n_initial:] if k not in used]
    if len(remaining) < n_test:
        return None
    test_keys = remaining[:n_test]

    before_render = _render(tree_ref["root"])
    results = []
    for k in test_keys:
        splits = _insert(tree_ref, k, d)
        if splits is None:
            return None
        results.append({"key": k, "splits": splits, "root_after": _render(tree_ref["root"])})
        used.add(k)
        if _height(tree_ref["root"]) > 3:
            return None

    if n_test == 3:
        split_counts = tuple(r["splits"] for r in results)
        if len(set(split_counts)) == 1 and split_counts[0] == split_counts[-1] and split_counts[0] == results[0]["splits"] and len(set(r["root_after"] for r in results)) == 1:
            return None  # no discrimination

    return {"d": d, "before": before_render, "test_keys": test_keys, "results": results}


def _build_btree_drill(rng, seed, i, fmt, instance):
    d = instance["d"]
    before = instance["before"]
    key_seq = instance["test_keys"]
    total_splits = sum(r["splits"] for r in instance["results"])
    final_tree = instance["results"][-1]["root_after"]
    key_phrase = ", then ".join(str(k) for k in key_seq)
    order_suffix = " (in that order)" if len(key_seq) > 1 else ""

    if total_splits == 0:
        why = f"None of {key_phrase} overflowed a leaf (order {d} ⇒ max {2*d} keys) — every leaf had room."
    else:
        why = f"Inserting {key_phrase} in order overflowed a leaf {total_splits} time(s); each overflow promotes a separator upward."
    tip = "A node splits at full+1, not at full — count the keys before deciding."
    given = f"B+ tree, order d={d} (max {2*d} keys/node):\n{before}"

    prompt = f"Insert {key_phrase}{order_suffix}. How many nodes split, in total?"

    if fmt == "blank":
        content = {
            **_envelope(2 if d == 2 else 3),
            "prompt_md": f"```text\n{given}\n```\n{prompt} ___",
            "why_md": why,
            "how_md": HOW_MD_BTREE,
            "tip_md": tip,
            "accept": [str(total_splits)],
            "accept_mode": "numeric",
            "placeholder": "e.g. 2",
        }
        return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
                "source_slug": None, "format": "blank", "content": content,
                "status": "draft", "authored_by": f"generator:eval_cost.py@{seed}"}

    if fmt == "mcq":
        correct = final_tree
        wrong1 = before  # "nothing changed" distractor
        wrong2 = _render({"type": "leaf", "keys": sorted(set(key_seq))})  # implausible flat merge
        choices = list(dict.fromkeys([correct, wrong1, wrong2]))
        if len(choices) < 3:
            return None
        if any(len(c) > 90 for c in choices):
            return None
        rng.shuffle(choices)
        answer_idx = choices.index(correct)
        content = {
            **_envelope(2 if d == 2 else 3),
            "prompt_md": f"```text\n{given}\n```\nAfter inserting {key_phrase}{order_suffix}, what is the tree?",
            "why_md": why,
            "how_md": HOW_MD_BTREE,
            "tip_md": tip,
            "choices": choices,
            "answer_idx": answer_idx,
        }
        return {"course_id": COURSE_ID, "bucket": BUCKET, "code": _code(seed, i),
                "source_slug": None, "format": "mcq", "content": content,
                "status": "draft", "authored_by": f"generator:eval_cost.py@{seed}"}

    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--kind", choices=["cardinality", "btree"], required=True)
    ap.add_argument("--out", type=str, default=None)
    ap.add_argument("--formats", type=str, default="mcq,blank")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    formats = args.formats.split(",")

    out_rows = []
    attempts = 0
    max_attempts = 50 * args.count
    fmt_cycle = itertools.cycle(formats)

    while len(out_rows) < args.count and attempts < max_attempts:
        attempts += 1
        if args.kind == "cardinality":
            inst = _gen_cardinality_instance(rng)
            if inst is None:
                continue
            fmt = next(fmt_cycle)
            row = _build_cardinality_drill(rng, args.seed, len(out_rows) + 1, fmt, inst)
        else:
            inst = _gen_btree_instance(rng)
            if inst is None:
                continue
            fmt = next(fmt_cycle)
            row = _build_btree_drill(rng, args.seed, len(out_rows) + 1, fmt, inst)

        if row is None:
            continue
        errs = validate_row(row)
        if errs:
            continue
        out_rows.append(row)

    if len(out_rows) < args.count:
        print(f"eval_cost.py --kind {args.kind}: only produced {len(out_rows)}/{args.count} "
              f"after {attempts} attempts", file=sys.stderr)
        return 1

    text = "\n".join(json.dumps(r) for r in out_rows)
    if args.out:
        Path(args.out).write_text(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
