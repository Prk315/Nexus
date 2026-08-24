/**
 * Tests for the job extractor.
 *
 *   node --test n8n/job-applier/
 *
 * Node's built-in runner, no dependencies — this folder is deliberately outside
 * the npm workspace so that a job-pipeline change can never break an app build.
 *
 * Fixtures are real pages captured 2026-08-24 (scripts and styles stripped except
 * ld+json, to keep them a sane size). Every assertion below corresponds to
 * something that was actually wrong at some point during the probe, not to
 * coverage for its own sake.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  cheapGate,
  dedupeKey,
  extractJobPostingLd,
  extractJobindexStub,
  extractReadableText,
  normalizeLdJobPosting,
  parseJobindexFeed,
  pickDescription,
  termHit,
} from "./extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(here, "fixtures", n), "utf8");

// MARK: - TheHub / schema.org

test("extracts a JobPosting from a real TheHub page", () => {
  const posting = extractJobPostingLd(fixture("thehub-job.html"));
  assert.ok(posting, "no JobPosting found");
  assert.equal(posting["@type"], "JobPosting");
  assert.ok(posting.title);
});

test("normalizes a TheHub JobPosting into a flat row", () => {
  const posting = extractJobPostingLd(fixture("thehub-job.html"));
  const row = normalizeLdJobPosting(posting, {
    url: "https://thehub.io/jobs/x",
    sourceKind: "thehub",
  });
  assert.equal(row.source_kind, "thehub");
  assert.ok(row.title.length > 0);
  assert.ok(row.company, "hiringOrganization did not flatten to a company");
  // description arrives as HTML inside the JSON-LD and must come out as text
  assert.ok(!/<[a-z]+[ >]/i.test(row.description), "HTML leaked into description");
  assert.ok(row.description.length > 100);
});

test("finds a JobPosting nested in an @graph wrapper", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"x"},
      {"@type":"JobPosting","title":"Graph Job","hiringOrganization":{"name":"Acme"}}]}
  </script>`;
  assert.equal(extractJobPostingLd(html).title, "Graph Job");
});

test("a malformed ld+json block does not hide a later valid one", () => {
  const html =
    `<script type="application/ld+json">{ this is not json }</script>` +
    `<script type="application/ld+json">{"@type":"JobPosting","title":"Second"}</script>`;
  assert.equal(extractJobPostingLd(html).title, "Second");
});

test("TELECOMMUTE is the remote signal; absence is unknown, not false", () => {
  const remote = normalizeLdJobPosting(
    { "@type": "JobPosting", title: "t", jobLocationType: "TELECOMMUTE" },
    { url: "u", sourceKind: "thehub" },
  );
  assert.equal(remote.remote, true);
  const unknown = normalizeLdJobPosting(
    { "@type": "JobPosting", title: "t" },
    { url: "u", sourceKind: "thehub" },
  );
  assert.equal(unknown.remote, null, "missing remote flag must be null, not false");
});

// MARK: - Jobindex feed

test("parses the real Jobindex feed", () => {
  const items = parseJobindexFeed(fixture("jobindex-feed.xml"));
  assert.equal(items.length, 20, "Jobindex serves 20 items per feed");
  for (const it of items) {
    assert.ok(it.title, "item without a title");
    assert.ok(/^https:\/\/www\.jobindex\.dk\/vis-job\//.test(it.url));
    assert.ok(it.external_id?.startsWith("h"));
  }
});

test("company is split on the LAST comma, not the first", () => {
  const items = parseJobindexFeed(fixture("jobindex-feed.xml"));
  const multi = items.find((i) => i.title.includes(","));
  assert.ok(multi, "fixture no longer contains a multi-comma title");
  // "Student Assistant, Component Sales, Semco Maritime A/S"
  assert.ok(!multi.company.includes(","), `company over-split: ${multi.company}`);
  const semco = items.find((i) => i.company === "Semco Maritime A/S");
  assert.ok(semco, "expected Semco item");
  assert.equal(semco.title, "Student Assistant, Component Sales");
});

test("carries the Danish category taxonomy through for the gate", () => {
  const items = parseJobindexFeed(fixture("jobindex-feed.xml"));
  assert.ok(items.some((i) => i.categories.length > 0), "no categories parsed");
});

// MARK: - Jobindex stub

test("reads title, location and target link off a real /vis-job/ stub", () => {
  const stub = extractJobindexStub(fixture("jobindex-visjob.html"));
  assert.equal(stub.title, "Senior Engineer for Cybersecurity testing");
  assert.match(stub.location, /Bjerringbro/);
  assert.equal(stub.remote, true, "'Hybrid position' should read as remote-ish");
  assert.ok(stub.target_url?.startsWith("https://jobs.grundfos.com/"));
});

test("the target link never resolves to a recruitment video", () => {
  // Regression: one real ad's first data-click link was a YouTube promo. Picking
  // "first outbound data-click link" fetched the video page as the job body.
  const html = `
    <h4><a href="https://youtu.be/abc123">Watch our video</a></h4>
    <a href="https://youtu.be/abc123" data-click="/c?t=h1">video</a>
    <a href="https://career.example.com/jobs/42" data-click="/c?t=h1">apply</a>`;
  assert.equal(extractJobindexStub(html).target_url, "https://career.example.com/jobs/42");
});

test("a Jobindex-hosted ad page is a valid target, not a failure", () => {
  const html = `<h4><a href="https://www.jobindex.dk/jobannonce/h169/x">T</a></h4>`;
  assert.equal(
    extractJobindexStub(html).target_url,
    "https://www.jobindex.dk/jobannonce/h169/x",
  );
});

// MARK: - Readable text

test("pulls the ad body out of a Jobindex-hosted ad page", () => {
  const text = extractReadableText(fixture("jobindex-jobannonce.html"));
  assert.ok(text.length > 1000, `expected a full ad body, got ${text.length} chars`);
  assert.match(text, /Student Assistant/);
});

test("does not return the cookie banner as the ad body", () => {
  // Regression: on the /jobannonce/ fixture the single largest <div> is the
  // consent notice. A naive longest-block heuristic stored that as the job.
  const text = extractReadableText(fixture("jobindex-jobannonce.html"));
  assert.doesNotMatch(text.slice(0, 400), /cookies og personoplysninger/i);
});

// MARK: - Dedup

test("the same job from two sources collapses to one key", () => {
  assert.equal(
    dedupeKey("Grundfos A/S", "Senior Engineer for Cybersecurity testing"),
    dedupeKey("grundfos", "Senior Engineer for Cybersecurity Testing"),
  );
});

test("different roles at the same company stay distinct", () => {
  assert.notEqual(dedupeKey("Grundfos A/S", "IT-supporter"), dedupeKey("Grundfos A/S", "QA Lead"));
});

// MARK: - Keyword matching
//
// Every case below is from a live dry run over eight real ads, where substring
// matching passed a chef and a Head of Legal as AI Engineering matches.

test("a short keyword does not match inside a longer word", () => {
  assert.equal(termHit("we offer training and maintenance", "ai"), false);
  assert.equal(termHit("plenty of available roles", "ai"), false);
  assert.equal(termHit("you will work with ai models", "ai"), true);
});

test("'engine' does not match 'Engineer'", () => {
  assert.equal(termHit("field service engineer", "engine"), false);
  assert.equal(termHit("our game engine team", "engine"), true);
});

test("keywords ending in punctuation still match", () => {
  // \b is defined on word characters and fails after '+' or '#', which is why
  // termHit uses explicit lookarounds instead.
  assert.equal(termHit("strong c++ skills", "c++"), true);
  assert.equal(termHit("we use c# and .net", "c#"), true);
  assert.equal(termHit("we use c# and .net", ".net"), true);
  assert.equal(termHit("c++ is required", "c"), false);
});

test("multi-word phrases match", () => {
  assert.equal(termHit("experience with machine learning pipelines", "machine learning"), true);
  assert.equal(termHit("machines are learning", "machine learning"), false);
});

test("a chef is not an AI engineer", () => {
  const aiProfile = { keywords: ["machine learning", "ai", "llm", "pytorch"] };
  const chef = {
    title: "Independent working Chef",
    description: "You will maintain a clean kitchen. Training is available.",
  };
  assert.equal(cheapGate(chef, aiProfile).verdict, "dropped");
});

// MARK: - pickDescription

test("the longest candidate wins", () => {
  assert.equal(pickDescription("short", "a much longer description here", ""), "a much longer description here");
});

test("a short application form does not overwrite a longer lead", () => {
  // Following a Jobindex ad to its apply link often lands on an application form
  // (hr-manager.net/ApplicationInit.aspx). Taking the last extraction replaced a
  // 161-char og:description lead with 34 chars of form furniture.
  const lead = "Are you passionate about breaking into embedded systems and uncovering vulnerabilities?";
  assert.equal(pickDescription(lead, "", "Log in to apply"), lead);
});

test("null and undefined candidates are ignored", () => {
  assert.equal(pickDescription(null, undefined, "real text"), "real text");
  assert.equal(pickDescription(null, undefined), "");
});

// MARK: - The cheap gate

const profile = {
  keywords: ["unity", "game", "developer"],
  exclude_terms: ["security clearance"],
  locations: ["copenhagen", "remote"],
  category_allow: ["Systemudvikling og programmering"],
};

test("passes a matching posting", () => {
  const g = cheapGate(
    { title: "Unity Developer", description: "gameplay", location: "Copenhagen", categories: [] },
    profile,
  );
  assert.equal(g.verdict, "pass");
});

test("every drop carries a reason", () => {
  const g = cheapGate(
    { title: "Unity Developer", description: "needs security clearance", location: "Copenhagen" },
    profile,
  );
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /security clearance/);
});

test("remote overrides a location miss", () => {
  const g = cheapGate(
    { title: "Game Developer", description: "", location: "Aarhus", remote: true },
    profile,
  );
  assert.equal(g.verdict, "pass", "a remote job outside the listed cities is still viable");
});

test("an unparseable valid_through does not read as expired", () => {
  // Dropping on a date we simply failed to parse would silently discard every ad
  // from a source whose format we have not met yet.
  const g = cheapGate(
    { title: "Unity Developer", description: "", valid_through: "not-a-date" },
    { keywords: ["unity"] },
  );
  assert.equal(g.verdict, "pass");
});

test("an expired posting is dropped", () => {
  const g = cheapGate(
    { title: "Unity Developer", description: "", valid_through: "2020-01-01" },
    { keywords: ["unity"] },
    new Date("2026-08-24"),
  );
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /closed/);
});

test("a category mismatch is dropped, but only when the ad has categories", () => {
  const withCat = cheapGate(
    { title: "Unity Developer", description: "", categories: ["Kontor"], location: "Copenhagen" },
    profile,
  );
  assert.equal(withCat.verdict, "dropped");
  const withoutCat = cheapGate(
    { title: "Unity Developer", description: "", categories: [], location: "Copenhagen" },
    profile,
  );
  assert.equal(withoutCat.verdict, "pass", "no categories must not mean no match");
});
