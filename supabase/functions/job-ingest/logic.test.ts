/**
 * job-ingest — pure-logic tests for the phase-3 approval and submission layer.
 *
 * Run:
 *
 *     node --test supabase/functions/job-ingest/logic.test.ts
 *
 * `node:test` rather than `jsr:@std/assert`, for the reason spelled out at the
 * top of `../job-approve/logic.test.ts`: there is no Deno on this machine, Node
 * 24 strips types natively, and a test that cannot be executed is a comment. This
 * file's import graph (`./logic.ts` -> `../n8n-ingest/logic.ts`) reaches nothing
 * outside the repo, so it runs with no build step.
 *
 * # Scope
 *
 * Phase 3 only. The phase-1 gate and the phase-2 assembler are pinned by
 * `n8n/job-applier/extract.test.js` and `evaluate.test.js`, which cover the
 * n8n-side copies of the same rules and are the tests that would catch a drift.
 *
 * Every case here is drawn from something that would go wrong silently. The
 * guard matrix in particular: each row is a decision about whether to email a
 * stranger, and getting a SKIP and a TERMINAL the wrong way round either drops
 * good work permanently or re-scans a dead row forever — neither of which
 * announces itself.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  type ApplyCandidate,
  type ApplyContext,
  bodyHasUnresolvedGaps,
  collapseByPosting,
  cvGateReady,
  DAILY_SUBMIT_CAP,
  deadlinePassed,
  DEFAULT_APPLY,
  DEFAULT_NOTIFY,
  MAX_APPLY,
  MAX_NOTIFY,
  normalizeProof,
  type NotifyCollapseCandidate,
  type NotifyDraftRow,
  type NotifyMatchRow,
  type NotifyProfile,
  parseApplyLimit,
  parseApplyResult,
  parseNotifyLimit,
  parseNotifyResult,
  parseStrictBool,
  planApplyQueue,
  reviewUrl,
  selectNotifyCandidates,
  utcDayStart,
} from "./logic.ts";

const NOW = Date.parse("2026-08-26T12:00:00Z");
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP = (n: number) => `1111111${n}-2222-4333-8444-555555555555`;

// ---------------------------------------------------------------------------
describe("guard 1 — unresolved gaps", () => {
  it("catches the markers the assembler and the stub modules emit", () => {
    assert.equal(bodyHasUnresolvedGaps("a\n\n[GAP: no module for 'project']"), true);
    assert.equal(bodyHasUnresolvedGaps("CV: [TODO paste the link]"), true);
    assert.equal(bodyHasUnresolvedGaps("Dear team,\n\nI would like to apply."), false);
  });

  it("treats a missing body as unfinished, not as finished", () => {
    // Fails toward "do not send", the same direction every accidental path in
    // this project is required to fail (CLAUDE.md: never fail toward unblocked).
    assert.equal(bodyHasUnresolvedGaps(null), true);
    assert.equal(bodyHasUnresolvedGaps(undefined), true);
    assert.equal(bodyHasUnresolvedGaps(123), true);
    assert.equal(bodyHasUnresolvedGaps(""), false, "an empty string is a real, gap-free string");
  });

  it("is case-sensitive, so an ad containing the word 'todo' cannot block a send", () => {
    assert.equal(bodyHasUnresolvedGaps("we have a [todo] list culture"), false);
    assert.equal(bodyHasUnresolvedGaps("we have a [gap] year policy"), false);
  });
});

// ---------------------------------------------------------------------------
describe("guard 4 — the CV gate", () => {
  it("wants an enabled, non-stub cv_link module", () => {
    assert.equal(cvGateReady([{ id: "1", slot: "cv_link", content: "https://cv.example/me.pdf" }]), true);
    assert.equal(cvGateReady([{ id: "1", slot: "cv_link", content: "CV: [TODO]" }]), false);
    assert.equal(cvGateReady([{ id: "1", slot: "cv_link", content: "   " }]), false);
    assert.equal(cvGateReady([{ id: "1", slot: "cv_link", content: null }]), false);
    assert.equal(cvGateReady([]), false);
  });

  it("ignores modules in other slots", () => {
    assert.equal(cvGateReady([{ id: "1", slot: "intro", content: "https://cv.example" }]), false);
  });

  it("does not care about the slot's casing", () => {
    assert.equal(cvGateReady([{ id: "1", slot: "CV_Link", content: "https://cv.example" }]), true);
  });
});

// ---------------------------------------------------------------------------
describe("guard 2 — the deadline", () => {
  it("never folds an unknown deadline into 'expired'", () => {
    assert.equal(deadlinePassed(null, NOW), false);
    assert.equal(deadlinePassed("", NOW), false);
    assert.equal(deadlinePassed("whenever", NOW), false);
  });

  it("compares real instants", () => {
    assert.equal(deadlinePassed("2026-08-25T23:00:00Z", NOW), true);
    assert.equal(deadlinePassed("2026-08-27T00:00:00Z", NOW), false);
  });

  it("accepts the epoch spellings coerceTimestamp handles", () => {
    assert.equal(deadlinePassed(Date.parse("2026-08-01T00:00:00Z"), NOW), true);
  });
});

// ---------------------------------------------------------------------------
describe("the daily-cap window", () => {
  it("is midnight UTC of the current day", () => {
    assert.equal(utcDayStart(NOW), "2026-08-26T00:00:00.000Z");
    assert.equal(utcDayStart(Date.parse("2026-08-26T23:59:59Z")), "2026-08-26T00:00:00.000Z");
    assert.equal(utcDayStart(Date.parse("2026-08-27T00:00:00Z")), "2026-08-27T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
describe("planApplyQueue — the six send-time guards", () => {
  const candidate = (over: Partial<ApplyCandidate> = {}, n = 1): ApplyCandidate => ({
    id: APP(n),
    body: "Application: X — Acme\n\nDear team,",
    posting: {
      id: "p1",
      title: "AI Engineer",
      company: "Acme",
      url: "https://example.com/1",
      apply_channel: "email",
      apply_email: "jobs@example.com",
      valid_through: null,
      dedupe_key: "acme|ai-engineer",
    },
    profile_name: "AI Engineering",
    ...over,
  });

  const ctx = (over: Partial<ApplyContext> = {}): ApplyContext => ({
    cvReady: true,
    submittedDedupeKeys: new Set<string>(),
    budget: DAILY_SUBMIT_CAP,
    limit: 2,
    nowMs: NOW,
    ...over,
  });

  it("queues a clean candidate", () => {
    const plan = planApplyQueue([candidate()], ctx());
    assert.equal(plan.queue.length, 1);
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.expire, []);
    assert.deepEqual(plan.cancel, []);
    assert.deepEqual(plan.queue[0].posting, {
      title: "AI Engineer",
      company: "Acme",
      apply_email: "jobs@example.com",
      url: "https://example.com/1",
    });
    assert.equal(plan.queue[0].profile_name, "AI Engineering");
  });

  it("1. SKIPS a body with gap markers — fixable, so the row stays approved", () => {
    const plan = planApplyQueue([candidate({ body: "x\n\n[GAP: no module for 'cv_link']" })], ctx());
    assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "body_has_gaps" }]);
    assert.equal(plan.queue.length, 0);
    assert.equal(plan.expire.length + plan.cancel.length, 0, "must not go terminal");
  });

  it("2. EXPIRES a closed posting — nothing reopens an ad", () => {
    const c = candidate();
    c.posting!.valid_through = "2026-08-01T00:00:00Z";
    const plan = planApplyQueue([c], ctx());
    assert.deepEqual(plan.expire, [{ application_id: APP(1), reason: "valid_through_passed" }]);
    assert.equal(plan.queue.length, 0);
  });

  it("3. SKIPS a non-email channel — a human can still apply by hand", () => {
    for (const over of [{ apply_channel: "ats" }, { apply_channel: "email", apply_email: "" }, {
      apply_channel: null,
    }]) {
      const c = candidate();
      Object.assign(c.posting!, over);
      const plan = planApplyQueue([c], ctx());
      assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "not_email_channel" }]);
      assert.equal(plan.expire.length + plan.cancel.length, 0);
    }
  });

  it("3. accepts a channel whose casing differs and trims the address", () => {
    const c = candidate();
    Object.assign(c.posting!, { apply_channel: "Email", apply_email: "  jobs@example.com  " });
    const plan = planApplyQueue([c], ctx());
    assert.equal(plan.queue[0].posting.apply_email, "jobs@example.com");
  });

  it("4. SKIPS when no CV module is ready — it unblocks everything at once", () => {
    const plan = planApplyQueue([candidate()], ctx({ cvReady: false }));
    assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "cv_missing" }]);
    assert.equal(plan.expire.length + plan.cancel.length, 0);
  });

  it("5. CANCELS a second application to a company already applied to", () => {
    const plan = planApplyQueue(
      [candidate()],
      ctx({ submittedDedupeKeys: new Set(["acme|ai-engineer"]) }),
    );
    assert.deepEqual(plan.cancel, [
      { application_id: APP(1), reason: "duplicate_company_application" },
    ]);
    assert.equal(plan.queue.length, 0);
  });

  it("5. does not cancel on an empty dedupe key", () => {
    const c = candidate();
    c.posting!.dedupe_key = "";
    const plan = planApplyQueue([c], ctx({ submittedDedupeKeys: new Set([""]) }));
    assert.equal(plan.cancel.length, 0);
    assert.equal(plan.queue.length, 1);
  });

  it("6. reports everything the daily cap excludes, and nothing the limit does", () => {
    const four = [1, 2, 3, 4].map((n) => candidate({ id: APP(n) }, n));
    // Budget 2, limit 10: two queue, two are reported as daily_cap.
    const capped = planApplyQueue(four, ctx({ budget: 2, limit: 10 }));
    assert.equal(capped.queue.length, 2);
    assert.deepEqual(capped.skipped, [
      { application_id: APP(3), reason: "daily_cap" },
      { application_id: APP(4), reason: "daily_cap" },
    ]);

    // Budget 4, limit 2: two queue and the rest simply wait for the next poll —
    // reporting them would make a healthy queue look like a wall of skips.
    const limited = planApplyQueue(four, ctx({ budget: 4, limit: 2 }));
    assert.equal(limited.queue.length, 2);
    assert.deepEqual(limited.skipped, []);
  });

  it("6. queues nothing at all once the cap is spent", () => {
    const plan = planApplyQueue([candidate()], ctx({ budget: 0 }));
    assert.equal(plan.queue.length, 0);
    assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "daily_cap" }]);

    // A negative budget (in-flight rows pushed it past the cap) behaves as zero,
    // never as "queue everything".
    const over = planApplyQueue([candidate()], ctx({ budget: -3 }));
    assert.equal(over.queue.length, 0);
  });

  it("skips a row whose posting embed came back empty rather than sending blind", () => {
    const plan = planApplyQueue([candidate({ posting: null })], ctx());
    assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "posting_missing" }]);
  });

  it("applies guards in contract order: gaps are reported before an expiry", () => {
    // Documented consequence, pinned so a future reorder is a deliberate act:
    // an application that is BOTH gap-blocked and past its deadline reports
    // body_has_gaps and stays approved. Stale, not wrong.
    const c = candidate({ body: "[GAP: no module for 'project']" });
    c.posting!.valid_through = "2026-01-01T00:00:00Z";
    const plan = planApplyQueue([c], ctx());
    assert.deepEqual(plan.skipped, [{ application_id: APP(1), reason: "body_has_gaps" }]);
    assert.deepEqual(plan.expire, []);
  });

  it("handles a mixed batch without letting one bad row block the good ones", () => {
    const good = candidate({ id: APP(1) }, 1);
    const gapped = candidate({ id: APP(2), body: "[TODO]" }, 2);
    const dupe = candidate({ id: APP(3) }, 3);
    dupe.posting!.dedupe_key = "other|role";
    const plan = planApplyQueue(
      [gapped, good, dupe],
      ctx({ submittedDedupeKeys: new Set(["other|role"]) }),
    );
    assert.deepEqual(plan.queue.map((q) => q.application_id), [APP(1)]);
    assert.deepEqual(plan.skipped, [{ application_id: APP(2), reason: "body_has_gaps" }]);
    assert.deepEqual(plan.cancel.map((c) => c.application_id), [APP(3)]);
  });

  it("is empty in, empty out", () => {
    assert.deepEqual(planApplyQueue([], ctx()), {
      queue: [],
      expire: [],
      cancel: [],
      skipped: [],
    });
  });
});

// ---------------------------------------------------------------------------
describe("selectNotifyCandidates", () => {
  const draft = (n: number, over: Partial<NotifyDraftRow> = {}): NotifyDraftRow => ({
    id: APP(n),
    posting_id: `p${n}`,
    profile_id: `f${n}`,
    body: "letter",
    missing_slots: [],
    approval_token: `token-${n}`,
    job_postings: { title: `Role ${n}`, company: "Acme", url: "https://x/1" },
    job_profiles: { id: `f${n}`, name: "AI Engineering", approval_threshold: 75 },
    ...over,
  });

  const match = (n: number, score: number | null): NotifyMatchRow => ({
    posting_id: `p${n}`,
    profile_id: `f${n}`,
    score,
    reasoning: "because",
    matched_skills: ["python"],
    missing_skills: ["k8s"],
  });

  const opts = { limit: 5, supabaseUrl: "https://ref.supabase.co" };

  it("keeps only drafts at or above their own profile's threshold", () => {
    const out = selectNotifyCandidates(
      [draft(1), draft(2)],
      [match(1, 80), match(2, 74)],
      opts,
    );
    assert.deepEqual(out.map((i) => i.application_id), [APP(1)]);
  });

  it("treats the threshold as inclusive", () => {
    assert.equal(selectNotifyCandidates([draft(1)], [match(1, 75)], opts).length, 1);
  });

  it("respects a per-profile threshold rather than a global one", () => {
    const strict = draft(1, {
      job_profiles: { name: "Data Science", approval_threshold: 90 },
    });
    assert.equal(selectNotifyCandidates([strict], [match(1, 85)], opts).length, 0);
  });

  it("NEVER notifies on a null score, even against a zero threshold", () => {
    // The trap this test exists for: `null >= 0` is TRUE in JS. A profile set to
    // 0 would otherwise email every unscored draft in the backlog.
    const zero = draft(1, { job_profiles: { name: "Anything", approval_threshold: 0 } });
    assert.equal(selectNotifyCandidates([zero], [match(1, null)], opts).length, 0);
    assert.equal(selectNotifyCandidates([zero], [match(1, 0)], opts).length, 1);
  });

  it("drops a draft with no match row — nothing has judged it", () => {
    assert.equal(selectNotifyCandidates([draft(1)], [], opts).length, 0);
  });

  it("falls back to the column default when the profile embed is missing", () => {
    const orphan = draft(1, { job_profiles: null });
    assert.equal(selectNotifyCandidates([orphan], [match(1, 80)], opts).length, 1);
    assert.equal(selectNotifyCandidates([orphan], [match(1, 70)], opts).length, 0);
  });

  it("ranks best first and breaks ties deterministically", () => {
    const out = selectNotifyCandidates(
      [draft(1), draft(2), draft(3)],
      [match(1, 80), match(2, 95), match(3, 80)],
      opts,
    );
    assert.deepEqual(out.map((i) => i.score), [95, 80, 80]);
    assert.deepEqual(out.slice(1).map((i) => i.application_id), [APP(1), APP(3)]);
  });

  it("honours the limit", () => {
    const out = selectNotifyCandidates(
      [draft(1), draft(2), draft(3)],
      [match(1, 80), match(2, 95), match(3, 90)],
      { ...opts, limit: 2 },
    );
    assert.equal(out.length, 2);
  });

  it("builds the review link server-side and url-encodes the token", () => {
    const out = selectNotifyCandidates([draft(1)], [match(1, 80)], opts);
    assert.equal(
      out[0].review_url,
      "https://ref.supabase.co/functions/v1/job-approve?token=token-1",
    );
    assert.equal(
      reviewUrl("https://ref.supabase.co/", "a b&c"),
      "https://ref.supabase.co/functions/v1/job-approve?token=a%20b%26c",
    );
  });

  it("normalizes absent arrays so n8n never has to null-check them", () => {
    const sparse = draft(1, { missing_slots: null, body: null });
    const m = { ...match(1, 80), matched_skills: null, missing_skills: null };
    const [item] = selectNotifyCandidates([sparse], [m], opts);
    assert.deepEqual(item.missing_slots, []);
    assert.deepEqual(item.matched_skills, []);
    assert.deepEqual(item.missing_skills, []);
    assert.equal(item.body, null);
  });
});

// ---------------------------------------------------------------------------
// One posting, one decision email.
//
// The bug: `job_applications` is keyed `(posting_id, profile_id)`, so an ad
// matching two profiles is two drafts. Two drafts were two decision emails, two
// review links and two live tokens for what a human reads as ONE job — and
// approving both sends the same company two letters from the same person.
//
// Every case below is about a way that could silently come back: a
// non-deterministic winner (the letter that got sent becomes a coin flip nobody
// can reproduce), a limit spent on duplicates (a backlog that never drains), or
// a suppressed sibling that keeps being re-offered forever.
describe("collapseByPosting", () => {
  const cand = (
    over: Partial<NotifyCollapseCandidate> & { application_id: string },
  ): NotifyCollapseCandidate => ({
    posting_id: "p1",
    score: 80,
    profile_sort: 0,
    profile_name: "AI Engineering",
    ...over,
  });

  it("keeps the highest score per posting and leaves other postings alone", () => {
    const winners = collapseByPosting([
      cand({ application_id: "a", score: 80 }),
      cand({ application_id: "b", score: 91 }),
      cand({ application_id: "c", score: 77, posting_id: "p2" }),
    ]);
    assert.deepEqual([...winners].sort(), ["b", "c"]);
  });

  it("breaks a score tie on profile sort, lowest first", () => {
    const winners = collapseByPosting([
      cand({ application_id: "a", profile_sort: 3, profile_name: "Aaa" }),
      cand({ application_id: "b", profile_sort: 1, profile_name: "Zzz" }),
    ]);
    // Sort beats name: the human's own ordering of their profiles is a stronger
    // statement than the alphabet.
    assert.deepEqual([...winners], ["b"]);
  });

  it("breaks a sort tie on profile name, then on application id", () => {
    assert.deepEqual(
      [...collapseByPosting([
        cand({ application_id: "a", profile_name: "Zzz" }),
        cand({ application_id: "b", profile_name: "Aaa" }),
      ])],
      ["b"],
    );
    assert.deepEqual(
      [...collapseByPosting([
        cand({ application_id: "b" }),
        cand({ application_id: "a" }),
      ])],
      ["a"],
    );
  });

  it("sorts a null profile name last rather than as an empty string", () => {
    // Absent is not "first alphabetically". A named profile should win.
    assert.deepEqual(
      [...collapseByPosting([
        cand({ application_id: "a", profile_name: null }),
        cand({ application_id: "b", profile_name: "Zzz" }),
      ])],
      ["b"],
    );
  });

  it("picks the same winner regardless of input order", () => {
    // The whole reason the comparator is total. Row order out of Postgres is not
    // stable, and the suppression filter keys on the POSTING — so an unstable
    // winner means the letter that actually went out is a coin flip.
    const rows = [
      cand({ application_id: "a", score: 88, profile_sort: 2, profile_name: "B" }),
      cand({ application_id: "b", score: 88, profile_sort: 2, profile_name: "A" }),
      cand({ application_id: "c", score: 88, profile_sort: 2, profile_name: "A" }),
    ];
    const forward = [...collapseByPosting(rows)];
    const reverse = [...collapseByPosting([...rows].reverse())];
    assert.deepEqual(forward, ["c" < "b" ? "c" : "b"]);
    assert.deepEqual(forward, reverse);
  });

  it("is a no-op on an empty batch", () => {
    assert.equal(collapseByPosting([]).size, 0);
  });
});

// ---------------------------------------------------------------------------
describe("notify_queue: one email per posting", () => {
  // Two profiles, ONE posting. The shape of the bug.
  const sibling = (
    n: number,
    over: Partial<NotifyDraftRow> & { job_profiles?: NotifyProfile | null } = {},
  ): NotifyDraftRow => ({
    id: APP(n),
    posting_id: "shared-posting",
    profile_id: `f${n}`,
    body: "letter",
    missing_slots: [],
    approval_token: `token-${n}`,
    job_postings: { title: "One Job", company: "Acme", url: "https://x/1" },
    job_profiles: { id: `f${n}`, name: `Profile ${n}`, approval_threshold: 75, sort: n },
    ...over,
  });

  const verdict = (n: number, score: number): NotifyMatchRow => ({
    posting_id: "shared-posting",
    profile_id: `f${n}`,
    score,
    reasoning: "because",
    matched_skills: [],
    missing_skills: [],
  });

  const opts = { limit: 5, supabaseUrl: "https://ref.supabase.co" };

  it("emails once about a posting that clears the threshold twice", () => {
    const out = selectNotifyCandidates(
      [sibling(1), sibling(2)],
      [verdict(1, 82), verdict(2, 90)],
      opts,
    );
    assert.equal(out.length, 1, "one job is one decision email");
    assert.equal(out[0].application_id, APP(2), "the higher score is the one sent");
    assert.equal(out[0].score, 90);
  });

  it("uses job_profiles.sort when two profiles score identically", () => {
    const out = selectNotifyCandidates(
      [sibling(1, { job_profiles: { name: "Second", approval_threshold: 75, sort: 5 } }),
        sibling(2, { job_profiles: { name: "First", approval_threshold: 75, sort: 1 } })],
      [verdict(1, 88), verdict(2, 88)],
      opts,
    );
    assert.deepEqual(out.map((i) => i.application_id), [APP(2)]);
    assert.equal(out[0].profile_name, "First");
  });

  it("collapses BEFORE the limit, so duplicates never eat the batch", () => {
    // Four drafts, two postings, limit 2. Pre-fix this returned two letters for
    // one job and never reached the second job at all.
    const other = (n: number): NotifyDraftRow => ({
      ...sibling(n),
      posting_id: "other-posting",
    });
    const otherVerdict = (n: number, score: number): NotifyMatchRow => ({
      ...verdict(n, score),
      posting_id: "other-posting",
    });
    const out = selectNotifyCandidates(
      [sibling(1), sibling(2), other(3), other(4)],
      [verdict(1, 99), verdict(2, 98), otherVerdict(3, 97), otherVerdict(4, 96)],
      { ...opts, limit: 2 },
    );
    assert.deepEqual(out.map((i) => i.application_id), [APP(1), APP(3)]);
    assert.deepEqual([...new Set(out.map((i) => i.score))].sort(), [97, 99]);
  });

  it("suppresses every draft for a posting already asked about", () => {
    // The across-polls half of the rule. Once the winner's email is out, the
    // losing siblings must stop qualifying — otherwise every poll re-collapses
    // them and the queue never empties.
    const out = selectNotifyCandidates(
      [sibling(1), sibling(2)],
      [verdict(1, 82), verdict(2, 90)],
      { ...opts, notifiedPostingIds: new Set(["shared-posting"]) },
    );
    assert.deepEqual(out, []);
  });

  it("suppresses only the named posting", () => {
    const out = selectNotifyCandidates(
      [sibling(1), { ...sibling(2), posting_id: "untouched" }],
      [verdict(1, 82), { ...verdict(2, 90), posting_id: "untouched" }],
      { ...opts, notifiedPostingIds: new Set(["shared-posting"]) },
    );
    assert.deepEqual(out.map((i) => i.application_id), [APP(2)]);
  });

  it("suppression outranks a high score", () => {
    // Deliberate: a 99 on a job already being decided is still the same job.
    const out = selectNotifyCandidates(
      [sibling(1)],
      [verdict(1, 99)],
      { ...opts, notifiedPostingIds: new Set(["shared-posting"]) },
    );
    assert.deepEqual(out, []);
  });

  it("changes nothing when the set is absent", () => {
    // Byte-compatibility with the deployed caller: an old payload that never
    // passes `notifiedPostingIds` must behave exactly as before.
    const out = selectNotifyCandidates([sibling(1)], [verdict(1, 99)], opts);
    assert.equal(out.length, 1);
  });
});

// ---------------------------------------------------------------------------
describe("request bodies", () => {
  it("refuses a truthy-but-not-true ok", () => {
    // n8n renders booleans into string fields and emits "" for an expression
    // that resolved to nothing. `Boolean("false")` is true, which would mark an
    // email that never sent as sent.
    assert.equal(parseStrictBool(true), true);
    assert.equal(parseStrictBool("true"), true);
    assert.equal(parseStrictBool(false), false);
    assert.equal(parseStrictBool("false"), false);
    for (const v of [1, 0, "", "yes", null, undefined, {}]) {
      assert.equal(parseStrictBool(v), null, `${JSON.stringify(v)} must not be guessed at`);
    }
  });

  it("validates notify_result", () => {
    const good = parseNotifyResult({ user_id: UID, application_id: APP(1), ok: true, message_id: "m1" });
    assert.ok(good.ok);
    assert.deepEqual(good.result, {
      userId: UID,
      applicationId: APP(1),
      ok: true,
      messageId: "m1",
    });

    assert.deepEqual(parseNotifyResult({ user_id: "x", application_id: APP(1), ok: true }), {
      ok: false,
      error: "invalid_user_id",
    });
    assert.deepEqual(parseNotifyResult({ user_id: UID, application_id: "x", ok: true }), {
      ok: false,
      error: "invalid_application_id",
    });
    assert.deepEqual(parseNotifyResult({ user_id: UID, application_id: APP(1), ok: "" }), {
      ok: false,
      error: "invalid_ok",
    });
    assert.deepEqual(parseNotifyResult(null), { ok: false, error: "invalid_body" });
  });

  it("validates apply_result and sanitizes the error", () => {
    const r = parseApplyResult({
      user_id: UID,
      application_id: APP(1),
      ok: false,
      error: "550 rejected ‮",
    });
    assert.ok(r.ok);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "550 rejected", "control chars and bidi overrides stripped");
    assert.equal(r.result.proof, null);
  });

  it("keeps proof flat, bounded and string-valued", () => {
    assert.deepEqual(normalizeProof({ gmail_message_id: "abc", thread_id: "t1" }), {
      gmail_message_id: "abc",
      thread_id: "t1",
    });
    // Numbers and booleans stringify; nested objects are dropped rather than
    // letting an unbounded blob into a jsonb column a panel renders.
    assert.deepEqual(normalizeProof({ n: 5, b: true, nested: { a: 1 }, empty: "" }), {
      n: "5",
      b: "true",
    });
    assert.equal(normalizeProof(null), null);
    assert.equal(normalizeProof([1, 2]), null);
    assert.equal(normalizeProof({}), null);
    assert.equal(normalizeProof({ x: "" }), null);

    const long = normalizeProof({ id: "z".repeat(5000) });
    assert.ok(long && long.id.length <= 256);
  });
});

// ---------------------------------------------------------------------------
describe("batch limits", () => {
  it("clamps into range and defaults on nonsense", () => {
    assert.equal(parseNotifyLimit(undefined), DEFAULT_NOTIFY);
    assert.equal(parseNotifyLimit("3"), 3);
    assert.equal(parseNotifyLimit(0), 1);
    assert.equal(parseNotifyLimit(999), MAX_NOTIFY);
    assert.equal(parseNotifyLimit("abc"), DEFAULT_NOTIFY);

    assert.equal(parseApplyLimit(undefined), DEFAULT_APPLY);
    assert.equal(parseApplyLimit(99), MAX_APPLY);
    assert.equal(parseApplyLimit(-4), 1);
  });

  it("keeps the send batch smaller than the notify batch", () => {
    // Not arithmetic trivia: every apply item is an email to a stranger and every
    // notify item is an email to the user. The blast radii are not comparable.
    assert.ok(MAX_APPLY < MAX_NOTIFY);
    assert.ok(DAILY_SUBMIT_CAP <= MAX_APPLY);
  });
});
