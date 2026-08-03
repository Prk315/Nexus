// gen-source.mjs — build the AltStore/SideStore source (apps.json) that SideStore
// polls to discover new Nexus Local versions.
//
// Reads ci/source.base.json for the static metadata and injects the freshly built
// release into each app's `versions[]` array (newest first). SideStore treats a
// higher `version` than the installed build as an available update.
//
// Env in:
//   VERSION        e.g. 0.1.0
//   DOWNLOAD_URL   public URL of the .ipa release asset
//   IPA_SIZE       bytes
//   IPA_SHA256     hex (informational; SideStore doesn't verify it)
//   RELEASE_NOTES  optional changelog string
//   OUT_DIR        where to write the site (default: _site)
//
// The source is APPEND-friendly: adding a second app later means adding another
// entry to source.base.json's `apps[]` and passing its release in — the shape here
// doesn't change.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, "source.base.json"), "utf8"));

const {
  VERSION,
  DOWNLOAD_URL,
  IPA_SIZE = "0",
  RELEASE_NOTES = "",
  OUT_DIR = "_site",
  // Which app in apps[] this release belongs to (bundle id). Defaults to the
  // first/only app so the single-app case needs no extra wiring.
  TARGET_BUNDLE = base.apps[0]?.bundleIdentifier,
} = process.env;

if (!VERSION || !DOWNLOAD_URL) {
  console.error("gen-source: VERSION and DOWNLOAD_URL are required");
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const versionEntry = {
  version: VERSION,
  date,
  localizedDescription: RELEASE_NOTES || `Nexus Local ${VERSION}.`,
  downloadURL: DOWNLOAD_URL,
  size: Number(IPA_SIZE) || 0,
  minOSVersion: "14.0",
};

for (const app of base.apps) {
  if (app.bundleIdentifier !== TARGET_BUNDLE) continue;
  app.versions = app.versions ?? [];
  // Drop any existing entry for this version, then prepend (newest first).
  app.versions = app.versions.filter((v) => v.version !== VERSION);
  app.versions.unshift(versionEntry);
  // Mirror the newest into the legacy top-level fields for older clients.
  app.version = VERSION;
  app.versionDate = date;
  app.versionDescription = versionEntry.localizedDescription;
  app.downloadURL = DOWNLOAD_URL;
  app.size = versionEntry.size;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "apps.json"), JSON.stringify(base, null, 2) + "\n");

// A tiny landing page so the Pages root isn't a 404.
const sourceURL = "https://prk315.github.io/Nexus/apps.json";
writeFileSync(
  join(OUT_DIR, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexus Local — SideStore source</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0b12;color:#e6e6f0;max-width:40rem;margin:4rem auto;padding:0 1.25rem;line-height:1.6}
code{background:#1b1b2b;padding:.15rem .4rem;border-radius:.35rem}a{color:#8b8bff}</style>
<h1>◈ Nexus Local</h1>
<p>SideStore source for the Nexus ecosystem. Add this URL in SideStore → Sources → +:</p>
<p><code>${sourceURL}</code></p>
<p>Latest: <strong>Nexus Local ${VERSION}</strong> · ${date}</p>
<p><a href="./apps.json">apps.json</a> · <a href="https://github.com/Prk315/Nexus">repo</a></p>
`,
);

console.log(`gen-source: wrote ${OUT_DIR}/apps.json for ${TARGET_BUNDLE} ${VERSION} (${date})`);
console.log(`  downloadURL = ${DOWNLOAD_URL}`);
console.log(`  source URL  = ${sourceURL}`);
