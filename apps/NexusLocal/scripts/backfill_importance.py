#!/usr/bin/env python3
"""Backfill lr_concept.importance = per-course PageRank over the REVERSED
prerequisite graph (foundations score high), normalized so each course's
max importance = 1.0.

REST-only (no supabase-py dependency). Uses urllib + PostgREST pagination.
"""
import json
import urllib.request
import urllib.error
import networkx as nx

URL = "https://efxmzsdisaymtpebaxlp.supabase.co"

# read the anon key straight out of the NexusLocal .env
ENV_PATH = "/Users/bastianthomsen/Repositories/Nexus/apps/NexusLocal/.env"
KEY = None
with open(ENV_PATH) as f:
    for line in f:
        line = line.strip()
        if line.startswith("VITE_SUPABASE_ANON_KEY="):
            KEY = line.split("=", 1)[1].strip()
            break
assert KEY, "could not find VITE_SUPABASE_ANON_KEY in .env"

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}


def get_all(path_base, select, page_size=1000):
    """Paginate a GET through PostgREST using Range headers."""
    out = []
    offset = 0
    while True:
        req = urllib.request.Request(
            f"{URL}/rest/v1/{path_base}?select={select}&order={select.split(',')[0]}",
            headers={
                **HEADERS,
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
            },
        )
        with urllib.request.urlopen(req) as resp:
            chunk = json.loads(resp.read())
        out.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return out


def patch_batch(concept_ids_to_importance):
    """PATCH lr_concept.importance one row at a time via PostgREST filter
    (PostgREST has no native bulk-upsert-by-different-values in a single
    PATCH, so we issue one PATCH per concept, batched only for progress
    reporting)."""
    ok, fail = 0, 0
    for cid, imp in concept_ids_to_importance.items():
        req = urllib.request.Request(
            f"{URL}/rest/v1/lr_concept?concept_id=eq.{urllib.parse.quote(cid)}",
            data=json.dumps({"importance": imp}).encode(),
            headers={**HEADERS, "Prefer": "return=minimal"},
            method="PATCH",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
            ok += 1
        except urllib.error.HTTPError as e:
            fail += 1
            print(f"FAIL {cid}: {e.code} {e.read()}")
    return ok, fail


import urllib.parse  # noqa: E402  (used above)


def main():
    print("Fetching lr_concept, lr_topic, lr_concept_prereq ...")
    concepts = get_all("lr_concept", "concept_id,t_id")
    topics = get_all("lr_topic", "t_id,c_id")
    prereqs = get_all("lr_concept_prereq", "prereq_id,concept_id")
    print(f"  concepts={len(concepts)} topics={len(topics)} prereqs={len(prereqs)}")

    topic_to_course = {t["t_id"]: t["c_id"] for t in topics}
    concept_to_course = {}
    for c in concepts:
        cid = c["concept_id"]
        course = topic_to_course.get(c["t_id"])
        concept_to_course[cid] = course

    courses = sorted(set(v for v in concept_to_course.values() if v is not None))
    print(f"Courses found: {courses}")

    # group concepts per course
    concepts_by_course = {c: [] for c in courses}
    for cid, course in concept_to_course.items():
        if course is not None:
            concepts_by_course[course].append(cid)

    all_importance = {}
    per_course_top5 = {}
    per_course_count = {}

    for course in courses:
        course_concepts = set(concepts_by_course[course])
        # REVERSED prereq graph restricted to this course's concepts:
        # original edge prereq_id -> concept_id ("prereq_id is required for concept_id").
        # Reversed edge for PageRank: concept_id -> prereq_id, so importance
        # flows from dependents back onto their prerequisites (foundations
        # accumulate rank from everything that depends on them).
        G = nx.DiGraph()
        G.add_nodes_from(course_concepts)
        for e in prereqs:
            p, c = e["prereq_id"], e["concept_id"]
            if p in course_concepts and c in course_concepts:
                G.add_edge(c, p)  # reversed

        if G.number_of_nodes() == 0:
            continue

        pr = nx.pagerank(G, alpha=0.85)

        max_val = max(pr.values()) if pr else 1.0
        if max_val <= 0:
            max_val = 1.0
        normalized = {cid: (val / max_val) for cid, val in pr.items()}

        for cid, val in normalized.items():
            all_importance[cid] = val

        per_course_count[course] = len(normalized)
        top5 = sorted(normalized.items(), key=lambda kv: kv[1], reverse=True)[:5]
        per_course_top5[course] = top5

        print(f"course {course}: {len(normalized)} concepts, nodes={G.number_of_nodes()}, edges={G.number_of_edges()}")

    print(f"\nPatching importance for {len(all_importance)} concepts ...")
    ok, fail = patch_batch(all_importance)
    print(f"  ok={ok} fail={fail}")

    # --- verification ---
    print("\n=== Verification ===")
    concepts2 = get_all("lr_concept", "concept_id,t_id,importance,title")
    concept_to_course2 = {}
    title_by_id = {}
    for c in concepts2:
        cid = c["concept_id"]
        course = topic_to_course.get(c["t_id"])
        concept_to_course2[cid] = course
        title_by_id[cid] = c.get("title")

    for course in courses:
        course_ids = [cid for cid, crs in concept_to_course2.items() if crs == course]
        set_count = sum(1 for cid in course_ids if next((c["importance"] for c in concepts2 if c["concept_id"] == cid), None) is not None)
        print(f"course {course}: concept_count={len(course_ids)}")

    # more efficient set_count computation
    imp_by_id = {c["concept_id"]: c["importance"] for c in concepts2}
    for course in courses:
        course_ids = [cid for cid, crs in concept_to_course2.items() if crs == course]
        set_count = sum(1 for cid in course_ids if imp_by_id.get(cid) is not None)
        per_course_count[course] = (set_count, len(course_ids))

    print("\nCounts (importance set / total concepts) per course:")
    for course in courses:
        set_count, total = per_course_count[course]
        print(f"  course {course}: {set_count}/{total}")

    print("\nTop-5 per course by importance:")
    for course in courses:
        print(f"\n  course {course}:")
        top5 = per_course_top5.get(course, [])
        for cid, val in top5:
            print(f"    {cid:30s} {val:.4f}  {title_by_id.get(cid)}")


if __name__ == "__main__":
    main()
