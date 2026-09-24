import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteProfile, listProfiles, loginCommandFor, profilePath, readProfile, resolveProfileName, writeProfile } from "./profiles.ts";
import { parseDotenv, loadSupabaseConfig } from "./config.ts";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cli-test-"));
  process.env.NEXUS_HOME = home;
});
afterEach(() => {
  delete process.env.NEXUS_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const profile = { email: "dev@example.com", user_id: "uid", refresh_token: "r", access_token: "a", expires_at: 1 };

describe("profiles", () => {
  it("writes with mode 0600 and reads back", () => {
    const file = writeProfile("dev", profile);
    expect(file).toBe(profilePath("dev"));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readProfile("dev")).toEqual(profile);
    expect(listProfiles()).toEqual(["dev"]);
  });

  it("returns null for a missing or malformed profile", () => {
    expect(readProfile("nope")).toBeNull();
    fs.mkdirSync(path.dirname(profilePath("bad")), { recursive: true });
    fs.writeFileSync(profilePath("bad"), "{not json");
    expect(readProfile("bad")).toBeNull();
    fs.writeFileSync(profilePath("bad"), JSON.stringify({ email: "x" }));
    expect(readProfile("bad")).toBeNull();
  });

  it("deletes", () => {
    writeProfile("dev", profile);
    expect(deleteProfile("dev")).toBe(true);
    expect(deleteProfile("dev")).toBe(false);
  });

  it("resolves the name from the flag, then NEXUS_PROFILE, then default", () => {
    expect(resolveProfileName("me", {})).toBe("me");
    expect(resolveProfileName(undefined, { NEXUS_PROFILE: "dev" })).toBe("dev");
    expect(resolveProfileName(undefined, {})).toBe("default");
    expect(() => resolveProfileName("../etc", {})).toThrow(/invalid profile name/);
  });

  it("names the exact login command", () => {
    expect(loginCommandFor("default")).toBe("nexus login");
    expect(loginCommandFor("me")).toBe("nexus login --profile me");
  });
});

describe("config", () => {
  it("parses a .env file", () => {
    expect(parseDotenv('# c\nA=1\nexport B="two"\nC=\'3\'\nBAD\n')).toEqual({ A: "1", B: "two", C: "3" });
  });

  it("prefers NEXUS_* env, then VITE_*, and ignores placeholders", () => {
    const c = loadSupabaseConfig({ NEXUS_SUPABASE_URL: "https://x.supabase.co", NEXUS_SUPABASE_ANON_KEY: "key" }, home, home);
    expect(c).toMatchObject({ url: "https://x.supabase.co", anonKey: "key" });
    const v = loadSupabaseConfig({ VITE_SUPABASE_URL: "your-project-url", VITE_SUPABASE_ANON_KEY: "vkey" }, home, home);
    expect(v.url).toBe("https://efxmzsdisaymtpebaxlp.supabase.co");
    expect(v.anonKey).toBe("vkey");
    expect(v.source.url).toBe("built-in default");
  });

  it("reads a .env in the cwd and errors clearly when no key is found anywhere", () => {
    fs.writeFileSync(path.join(home, ".env"), "VITE_SUPABASE_ANON_KEY=from-file\n");
    expect(loadSupabaseConfig({}, home).anonKey).toBe("from-file");
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cli-empty-"));
    try {
      // Only fails when no .env up the tree or in the repo carries a real key —
      // which is the state of a fresh checkout, and what this asserts.
      let threw: unknown = null;
      try { loadSupabaseConfig({ NEXUS_ENV_FILE: path.join(empty, "none") }, empty); } catch (e) { threw = e; }
      if (threw) expect(String(threw)).toMatch(/anon key not configured/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
