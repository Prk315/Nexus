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
  buildAlertPosting,
  canonicalLinkedInJobUrl,
  cheapGate,
  dedupeKey,
  extractAlertPageEnrichment,
  extractJobPostingLd,
  extractJobindexCompany,
  extractJobindexStub,
  extractReadableText,
  locationVerdict,
  normalizeLdJobPosting,
  parseJobindexFeed,
  parseLinkedInAlertEmail,
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

// MARK: - LinkedIn job-alert email
//
// Fixtures are two real alert emails captured from the inbox 2026-08-25:
// `linkedin-alert.html` is a five-job digest, `linkedin-alert-2.html` a
// single-job alert. Both layouts ship from `jobalerts-noreply@linkedin.com` and
// a parser that only handles the digest silently harvests nothing from the other.

test("reads all five jobs out of a real LinkedIn digest", () => {
  const jobs = parseLinkedInAlertEmail(fixture("linkedin-alert.html"));
  // Each card links the same job three times — logo, wrapper, title. Fifteen here
  // means the grouping regressed and every job would be ingested in triplicate.
  assert.equal(jobs.length, 5);
  assert.deepEqual(jobs[0], {
    title: "Fullstack softwareudvikler i PET",
    company: "Politiets Efterretningstjeneste (PET)",
    location: "København",
    url: "https://www.linkedin.com/jobs/view/4444129797/",
    external_id: "4444129797",
    description: null,
  });
  assert.equal(new Set(jobs.map((j) => j.external_id)).size, 5, "duplicate ids");
  for (const j of jobs) {
    assert.ok(j.title, "job without a title");
    assert.match(j.url, /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/);
  }
});

test("a single-job alert is the same lane, not a special case", () => {
  const jobs = parseLinkedInAlertEmail(fixture("linkedin-alert-2.html"));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Associate Consultant, Netcompany Consulting");
  assert.equal(jobs[0].company, "Netcompany");
});

test("Danish characters survive the parse", () => {
  // The bodies arrive quoted-printable-encoded. Mojibake stored once is permanent.
  const jobs = parseLinkedInAlertEmail(fixture("linkedin-alert.html"));
  assert.ok(
    jobs.some((j) => j.location === "København") && jobs.some((j) => j.location === "Humlebæk"),
    `æ/ø mangled: ${jobs.map((j) => j.location).join(" | ")}`,
  );
});

test("company and location split on the middle dot, not a hyphen", () => {
  const jobs = parseLinkedInAlertEmail(fixture("linkedin-alert.html"));
  const hybrid = jobs.find((j) => j.location?.includes("Hybrid"));
  assert.ok(hybrid, "fixture no longer has a hybrid listing");
  // "SimCorp · København (Hybridarbejde)" — the parenthetical belongs to the
  // location, and splitting on the wrong character puts it in the company.
  assert.equal(hybrid.company, "SimCorp");
  assert.equal(hybrid.location, "København (Hybridarbejde)");
});

test("the tracking URL is reduced to the canonical job page", () => {
  // The real href is ~800 characters and carries an `otpToken` that signs the
  // recipient in. It must never be stored, and a URL-keyed seen-set built on it
  // would treat the same job as new every day, because trackingId rotates.
  // Token values are placeholders — the real ones are per-recipient credentials
  // and this repo is public. The fixtures are redacted the same way.
  const href =
    "https://www.linkedin.com/comm/jobs/view/4309759193/?trackingId=REDACTED%3D%3D&amp;" +
    "midToken=REDACTED&amp;trk=eml-email_job_alert_digest_01-primary_job_list-0-" +
    "jobcard_body_2_jobid_9999999999_ssid_1736807042&amp;otpToken=REDACTED";
  const canon = canonicalLinkedInJobUrl(href);
  assert.equal(canon.url, "https://www.linkedin.com/jobs/view/4309759193/");
  // `jobid_9999999999` also appears inside the trk parameter. Anchoring on
  // /jobs/view/ is what stops the tracking copy being read as the identity.
  assert.equal(canon.external_id, "4309759193");
  assert.equal(canonicalLinkedInJobUrl("https://www.linkedin.com/feed/"), null);
});

test("a mangled query string still canonicalizes", () => {
  // Real capture: quoted-printable decoding ate the '=' after trackingId, leaving
  // `?trackingId[hCc7…`. The path is intact, so the job must still resolve.
  assert.equal(
    canonicalLinkedInJobUrl("https://www.linkedin.com/comm/jobs/view/4402511151/?trackingId[hCc7")
      .url,
    "https://www.linkedin.com/jobs/view/4402511151/",
  );
});

test("a malformed or unrelated body yields [], never a throw", () => {
  // One odd email in a batch of twenty must not take the other nineteen down.
  assert.deepEqual(parseLinkedInAlertEmail(""), []);
  assert.deepEqual(parseLinkedInAlertEmail(null), []);
  assert.deepEqual(parseLinkedInAlertEmail(undefined), []);
  assert.deepEqual(parseLinkedInAlertEmail("<html><body><p>no jobs here</p>"), []);
  assert.deepEqual(parseLinkedInAlertEmail("<a href='https://www.linkedin.com/jobs/view/'>x</a>"), []);
});

test("a card with no location line does not borrow the next job's company", () => {
  // The card region is bounded at the next job id precisely so this cannot happen.
  const html =
    `<a href="https://www.linkedin.com/comm/jobs/view/1111111111/?t=1"><img alt="Acme"></a>` +
    `<a href="https://www.linkedin.com/comm/jobs/view/1111111111/?t=2">First Job</a>` +
    `<a href="https://www.linkedin.com/comm/jobs/view/2222222222/?t=3"><img alt="Globex"></a>` +
    `<a href="https://www.linkedin.com/comm/jobs/view/2222222222/?t=4">Second Job</a>` +
    `<p>Globex · Aarhus</p>`;
  const jobs = parseLinkedInAlertEmail(html);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "First Job");
  assert.equal(jobs[0].company, "Acme", "fell back to the logo alt, as designed");
  assert.equal(jobs[0].location, null, "an absent location must stay null, not be invented");
  assert.equal(jobs[1].company, "Globex");
  assert.equal(jobs[1].location, "Aarhus");
});

// MARK: - Alert-page enrichment

test("JSON-LD wins when the public page has it", () => {
  const html = `<script type="application/ld+json">
    {"@type":"JobPosting","title":"T","jobLocationType":"TELECOMMUTE",
     "description":"<p>Full ad body</p>","hiringOrganization":{"name":"Acme"}}</script>`;
  const e = extractAlertPageEnrichment(html, { url: "u", sourceKind: "gmail_alerts" });
  assert.equal(e.description, "Full ad body");
  assert.equal(e.remote, true);
});

test("og:description is the fallback, with LinkedIn's stock suffix removed", () => {
  // Probed live 2026-08-25: linkedin.com/jobs/view/<id>/ answers 200 with ZERO
  // ld+json blocks. og:description is the only body text a guest page gives.
  const html =
    `<meta property="og:description" content="Vil du bruge dine kompetencer, hvor de ` +
    `gør en forskel i en vigtig sag?…Se dette og tilsvarende job på LinkedIn.">`;
  const e = extractAlertPageEnrichment(html, { url: "u", sourceKind: "gmail_alerts" });
  assert.doesNotMatch(e.description, /LinkedIn/, "stock suffix leaked into the description");
  assert.match(e.description, /^Vil du bruge dine kompetencer/);
  assert.equal(e.remote, null, "og:description says nothing about remote");
});

test("an authwall or a stub enriches to null, not to junk", () => {
  assert.equal(extractAlertPageEnrichment("", { url: "u", sourceKind: "k" }), null);
  assert.equal(
    extractAlertPageEnrichment(`<meta property="og:description" content="Sign in">`, {
      url: "u",
      sourceKind: "k",
    }),
    null,
  );
});

// MARK: - buildAlertPosting

test("a failed enrichment still produces a usable posting", () => {
  // Dropping the job would make the lane's yield depend on LinkedIn's mood.
  const [job] = parseLinkedInAlertEmail(fixture("linkedin-alert-2.html"));
  const row = buildAlertPosting(job, { sourceKind: "gmail_alerts", enrichment: null });
  assert.equal(row.source_kind, "gmail_alerts");
  assert.equal(row.external_id, "4427828803");
  assert.equal(row.url, "https://www.linkedin.com/jobs/view/4427828803/");
  assert.equal(row.title, "Associate Consultant, Netcompany Consulting");
  assert.equal(row.company, "Netcompany");
  assert.equal(row.dedupe_key, dedupeKey("Netcompany", job.title));
  assert.deepEqual(row.categories, []);
});

test("nothing is guessed: unknown fields are null, remote included", () => {
  const row = buildAlertPosting(
    { title: "T", company: "C", location: "Aarhus", url: "u", external_id: "1" },
    { sourceKind: "gmail_alerts" },
  );
  for (const k of ["remote", "employment_type", "posted_at", "valid_through", "description", "ld_json"]) {
    assert.equal(row[k], null, `${k} was guessed instead of left unknown`);
  }
  // A guessed remote:false would be read by the gate as a fact and drop an
  // actually-remote job on a location miss.
  assert.notEqual(row.remote, false);
  assert.equal(row.apply_channel, "unknown");
});

test("enrichment fills the description without overwriting the email's facts", () => {
  const row = buildAlertPosting(
    { title: "T", company: "Email Co", location: "København", url: "u", external_id: "1" },
    {
      sourceKind: "gmail_alerts",
      enrichment: { description: "the real ad body", company: "LD Co", location: "Odense", remote: true },
    },
  );
  assert.equal(row.description, "the real ad body");
  assert.equal(row.remote, true);
  // The email is the source of truth for the alert lane; enrichment only fills gaps.
  assert.equal(row.company, "Email Co");
  assert.equal(row.location, "København");
});

test("an alert posting reaches the gate as any other posting does", () => {
  const [job] = parseLinkedInAlertEmail(fixture("linkedin-alert-2.html"));
  const row = buildAlertPosting(job, { sourceKind: "gmail_alerts" });
  // No description and no categories: the gate must run on the title alone rather
  // than throwing on the nulls.
  assert.equal(cheapGate(row, { keywords: ["consultant"] }).verdict, "pass");
  assert.equal(cheapGate(row, { keywords: ["unity"] }).verdict, "dropped");
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

// MARK: - The employer, and titles with internal commas
//
// All four cases below are the same posting from the first live run:
// jobindex.dk/vis-job/r13951651, whose feed title contains two commas and no
// company segment at all. It was stored with the employer "Konservering".

const ROYAL_TITLE =
  "To studentermedhjælpere søges til Det Kongelige Akademi - Arkitektur, Design, Konservering";
const ROYAL_COMPANY =
  "Det Kongelige Danske Kunstakademis Skoler for Arkitektur, Design og Konservering";

test("the feed split mis-reads a title whose own name contains commas", () => {
  // Documents the FALLBACK's known limit rather than pretending it is safe. There
  // is no information in the feed string that separates "<title>, <company>" from
  // a title that simply has commas, which is exactly why the stub is preferred.
  const xml = `<rss><channel><item><title>${ROYAL_TITLE}</title><link>https://www.jobindex.dk/vis-job/r13951651</link></item></channel></rss>`;
  const [job] = parseJobindexFeed(xml);
  assert.equal(job.company, "Konservering", "the split still does the wrong thing here");
  assert.equal(job.external_id, "r13951651");
});

test("the stub's toolbar carries the real employer, commas and all", () => {
  const html = fixture("jobindex-visjob-comma-company.html");
  assert.equal(extractJobindexCompany(html), ROYAL_COMPANY);
});

test("a robot-scraped stub has no company-profile card, so the toolbar must win", () => {
  // vp-card__name is absent on r-prefixed ads. It is the second signal, never the
  // first — reversing them would return null on every robot-scraped ad.
  const html = fixture("jobindex-visjob-comma-company.html");
  assert.ok(!html.includes("vp-card__name"), "fixture must keep exercising this path");
  assert.equal(extractJobindexStub(html).company, ROYAL_COMPANY);
});

test("a stub with neither signal returns null so the feed split can stand in", () => {
  // Returning "" or "unknown" here would overwrite a usable feed company with junk.
  assert.equal(extractJobindexCompany("<html><body>no company anywhere</body></html>"), null);
  assert.equal(extractJobindexCompany(""), null);
});

test("the paid-ad stub still reads its company", () => {
  assert.equal(extractJobindexCompany(fixture("jobindex-visjob.html")), "Grundfos A/S");
});

// MARK: - Location
//
// The first live run dropped 32 of 69 postings on location and about a third of
// those were Danish towns. `locationVerdict` must distinguish "somewhere else"
// from "somewhere I don't recognise".

const DK = ["copenhagen", "københavn", "remote", "denmark", "danmark"];

test("a Danish municipality that is not on the allow-list is unknown, not foreign", () => {
  // Every one of these was a real, wrongly-dropped posting.
  for (const town of ["Ishøj, Ishøj", "Gentofte", "Taastrup", "Ballerup", "Roskilde", "Humlebæk"]) {
    assert.equal(locationVerdict(town, DK), "unknown", town);
  }
});

test("a recognised foreign country is denied", () => {
  for (const loc of [
    "Oslo, Oslo, Norway",
    "Stockholm, Stockholm, Sweden",
    "València, València, Spain",
    "London, London, United Kingdom",
    "Munich, Munich, Germany",
    "Espoo, Espoo, Finland",
    "Norway, Norway, Norway",
  ]) {
    assert.equal(locationVerdict(loc, DK), "deny", loc);
  }
});

test("an allowed location is allowed even wrapped in a work-arrangement note", () => {
  assert.equal(locationVerdict("Copenhagen, Copenhagen, Denmark", DK), "allow");
  assert.equal(locationVerdict("København (Hybridarbejde)", DK), "allow");
  assert.equal(locationVerdict("Danmark", DK), "allow");
});

test("a parenthesised note does not hide the town", () => {
  // "Glostrup (På arbejdesstedet)" must read as unknown-Danish, not as a foreign
  // string — LinkedIn staples the work arrangement onto every location it emits.
  assert.equal(locationVerdict("Glostrup (På arbejdesstedet)", DK), "unknown");
  assert.equal(locationVerdict("Hørsholm Kommune (På arbejdesstedet)", DK), "unknown");
});

test("an unknown location does not drop the posting", () => {
  // The regression that mattered: a real Data Engineer role in Ishøj.
  const g = cheapGate(
    { title: "Data Engineer til Dagrofa IT", description: "", location: "Ishøj, Ishøj" },
    { keywords: ["data engineer"], locations: DK },
  );
  assert.equal(g.verdict, "pass");
});

test("a foreign posting is still dropped, unless it is remote", () => {
  const p = { title: "Data Engineer", description: "", location: "Oslo, Oslo, Norway" };
  assert.equal(cheapGate(p, { keywords: ["data engineer"], locations: DK }).verdict, "dropped");
  assert.equal(
    cheapGate({ ...p, remote: true }, { keywords: ["data engineer"], locations: DK }).verdict,
    "pass",
  );
});

test("a pass records which keyword matched", () => {
  // A bare `reason: null` made the first run's single stored row unexplainable.
  const g = cheapGate(
    { title: "Studenterjob", description: "erfaring med unity, unreal, blender 3d", location: "København K" },
    { keywords: ["unreal", "unity"], locations: DK },
  );
  assert.equal(g.verdict, "pass");
  assert.equal(g.reason, "keyword: unreal", "the reason names the term that actually hit");
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
