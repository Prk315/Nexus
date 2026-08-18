"""Shared validator for lr_sprint_drill content, per brief.md §B.

Importable (`from _validate import validate_row`) and runnable standalone
over a JSONL file of insert rows:

    python3 _validate.py drills.jsonl

Exits nonzero if any row fails. Prints one line per failing row to stderr.

This mirrors, but does not import, the TypeScript-side checks described in
brief.md §B and §D.6 — there is no shared runtime between the Python
generators and the TS app, so the two must be kept in sync by hand if the
schema changes.
"""

from __future__ import annotations

import json
import sys
from typing import Any


VALID_FORMATS = {"mcq", "truefalse", "blank", "tiles", "why"}
VALID_LENSES = {"nl", "ra", "rc", "sql", None}


def _err(msg: str) -> str:
    return msg


def validate_content_common(content: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if content.get("v") != 1:
        errs.append("v must be 1")

    lens = content.get("lens")
    if lens not in VALID_LENSES:
        errs.append(f"lens {lens!r} not in {VALID_LENSES}")

    concept_ids = content.get("concept_ids")
    if not isinstance(concept_ids, list):
        errs.append("concept_ids must be a list (possibly empty)")

    difficulty = content.get("difficulty")
    if difficulty not in (1, 2, 3):
        errs.append(f"difficulty {difficulty!r} must be 1|2|3")

    why_md = content.get("why_md")
    if not why_md or not isinstance(why_md, str):
        errs.append("why_md required")
    elif len(why_md) > 220:
        errs.append(f"why_md {len(why_md)} chars > 220")

    how_md = content.get("how_md")
    if not how_md or not isinstance(how_md, str):
        errs.append("how_md required")

    tip_md = content.get("tip_md")
    if not tip_md or not isinstance(tip_md, str):
        errs.append("tip_md required")
    elif len(tip_md) > 120:
        errs.append(f"tip_md {len(tip_md)} chars > 120")

    return errs


def _check_prompt_md(content: dict[str, Any], required: bool = True) -> list[str]:
    errs: list[str] = []
    prompt_md = content.get("prompt_md")
    if required and not prompt_md:
        errs.append("prompt_md required")
        return errs
    if prompt_md is not None:
        # Strip fenced blocks before measuring prose length.
        prose = prompt_md
        while "```" in prose:
            first = prose.find("```")
            second = prose.find("```", first + 3)
            if second == -1:
                break
            prose = prose[:first] + prose[second + 3 :]
        if len(prose) > 200:
            errs.append(f"prompt_md prose {len(prose)} chars > 200")
        fence_lines = prompt_md.count("\n") if "```" in prompt_md else 0
        if fence_lines > 6:
            errs.append("prompt_md fenced block > 6 lines")
    return errs


def validate_mcq(content: dict[str, Any]) -> list[str]:
    errs = _check_prompt_md(content)
    choices = content.get("choices")
    if not isinstance(choices, list) or not (2 <= len(choices) <= 4):
        errs.append("mcq choices must be a list of 2-4 items")
        choices = choices if isinstance(choices, list) else []
    for c in choices:
        if not isinstance(c, str) or len(c) > 90:
            errs.append(f"mcq choice too long or not a string: {c!r}")
    answer_idx = content.get("answer_idx")
    if not isinstance(answer_idx, int) or not (0 <= answer_idx < len(choices)):
        errs.append(f"mcq answer_idx {answer_idx!r} out of range")
    if "statement_md" in content:
        errs.append("mcq must not carry statement_md")
    return errs


def validate_truefalse(content: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if content.get("prompt_md"):
        errs.append("truefalse must not carry prompt_md")
    statement_md = content.get("statement_md")
    if not statement_md or not isinstance(statement_md, str):
        errs.append("truefalse statement_md required")
    elif len(statement_md) > 180:
        errs.append(f"statement_md {len(statement_md)} chars > 180")
    if not isinstance(content.get("answer"), bool):
        errs.append("truefalse answer must be bool")
    return errs


def validate_blank(content: dict[str, Any]) -> list[str]:
    errs = _check_prompt_md(content)
    prompt_md = content.get("prompt_md") or ""
    if "___" not in prompt_md:
        errs.append("blank prompt_md must contain literal ___")
    accept = content.get("accept")
    if not isinstance(accept, list) or len(accept) == 0:
        errs.append("blank accept must be a non-empty list")
    accept_mode = content.get("accept_mode", "exact")
    if accept_mode not in ("exact", "set", "numeric"):
        errs.append(f"blank accept_mode {accept_mode!r} invalid")
    return errs


def validate_tiles(content: dict[str, Any]) -> list[str]:
    errs = _check_prompt_md(content)
    tiles = content.get("tiles")
    if not isinstance(tiles, list) or not (4 <= len(tiles) <= 8):
        errs.append("tiles must be a list of 4-8 items")
        tiles = tiles if isinstance(tiles, list) else []
    ids = []
    for t in tiles:
        if not isinstance(t, dict) or "id" not in t or "md" not in t:
            errs.append(f"tile malformed: {t!r}")
            continue
        ids.append(t["id"])
        if len(t["md"]) > 24:
            errs.append(f"tile {t['id']} md {len(t['md'])} chars > 24: {t['md']!r}")
        if "```" in t["md"]:
            errs.append(f"tile {t['id']} md must not be a fenced block")
    if len(ids) != len(set(ids)):
        errs.append("duplicate tile ids")

    mode = content.get("mode", "build")
    if mode == "build":
        sequence = content.get("sequence")
        if not isinstance(sequence, list) or not sequence:
            errs.append("tiles build requires non-empty sequence")
            sequence = []
        bad = [s for s in sequence if s not in ids]
        if bad:
            errs.append(f"sequence ids not in tiles: {bad}")
        distractors = [i for i in ids if i not in sequence]
        if len(distractors) < 2:
            errs.append(f"tiles build needs >=2 distractors, has {len(distractors)}")
        for t in tiles:
            if isinstance(t, dict) and "correct" in t:
                errs.append("build mode tiles must not carry 'correct'")
    elif mode == "select":
        if "sequence" in content:
            errs.append("select mode must not carry sequence")
        corrects = [t.get("correct") for t in tiles if isinstance(t, dict)]
        if not all(isinstance(c, bool) for c in corrects):
            errs.append("select mode tiles must all carry boolean 'correct'")
        n_correct = sum(1 for c in corrects if c is True)
        if n_correct == 0 or n_correct == len(corrects):
            errs.append("select mode needs some but not all tiles correct")
    else:
        errs.append(f"tiles mode {mode!r} invalid")
    return errs


def validate_why(content: dict[str, Any]) -> list[str]:
    errs = _check_prompt_md(content)
    given_md = content.get("given_md")
    if not given_md or not isinstance(given_md, str):
        errs.append("why given_md required")
    choices = content.get("choices")
    if not isinstance(choices, list) or not (3 <= len(choices) <= 4):
        errs.append("why choices must be a list of 3-4 items")
        choices = choices if isinstance(choices, list) else []
    for c in choices:
        if not isinstance(c, str) or len(c) > 100:
            errs.append(f"why choice too long or not a string: {c!r}")
    answer_idx = content.get("answer_idx")
    if not isinstance(answer_idx, int) or not (0 <= answer_idx < len(choices)):
        errs.append(f"why answer_idx {answer_idx!r} out of range")
    return errs


_FORMAT_VALIDATORS = {
    "mcq": validate_mcq,
    "truefalse": validate_truefalse,
    "blank": validate_blank,
    "tiles": validate_tiles,
    "why": validate_why,
}


def validate_row(row: dict[str, Any]) -> list[str]:
    """Validate one full insert row: {course_id, bucket, code, source_slug,
    format, content, status, authored_by}. Returns a list of error strings
    (empty = valid)."""
    errs: list[str] = []

    for key in ("course_id", "bucket", "code", "format", "content", "status"):
        if key not in row:
            errs.append(f"missing top-level key {key!r}")
    if errs:
        return errs

    fmt = row["format"]
    if fmt not in VALID_FORMATS:
        errs.append(f"format {fmt!r} not in {VALID_FORMATS}")
        return errs

    content = row["content"]
    if not isinstance(content, dict):
        errs.append("content must be an object")
        return errs

    errs += validate_content_common(content)
    errs += _FORMAT_VALIDATORS[fmt](content)
    return errs


def validate_batch(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Cross-row checks (duplicate codes) plus per-row validation. Returns
    {code: [errors]} for rows with 1+ errors."""
    failures: dict[str, list[str]] = {}
    seen_codes: dict[str, int] = {}
    for row in rows:
        code = row.get("code", "<no code>")
        seen_codes[code] = seen_codes.get(code, 0) + 1
        errs = validate_row(row)
        if errs:
            failures[code] = errs
    for code, n in seen_codes.items():
        if n > 1:
            failures.setdefault(code, []).append(f"duplicate code, appears {n}x in batch")
    return failures


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: _validate.py drills.jsonl", file=sys.stderr)
        return 2
    rows = []
    with open(sys.argv[1]) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    failures = validate_batch(rows)
    if failures:
        for code, errs in failures.items():
            for e in errs:
                print(f"FAIL {code}: {e}", file=sys.stderr)
        print(f"{len(failures)}/{len(rows)} rows failed validation", file=sys.stderr)
        return 1
    print(f"{len(rows)}/{len(rows)} rows valid", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
