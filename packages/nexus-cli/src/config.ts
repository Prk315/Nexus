// Where the Supabase URL and anon key come from.
//
// Resolution order, first hit wins:
//   1. env: NEXUS_SUPABASE_URL / NEXUS_SUPABASE_ANON_KEY
//   2. env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (what the apps use)
//   3. a `.env` file, searched at: $NEXUS_ENV_FILE, then cwd upward to the
//      filesystem root, then the monorepo root relative to this package, then
//      apps/Vault/Vault/.env and apps/PathFinder/.env
//   4. for the URL only: the NEXUS project's public URL below
//
// The anon key is deliberately NOT embedded here. It has to be present in the
// environment or a `.env` file; a missing key is reported with the list of
// files that were searched. Placeholder values (`your-project-url`,
// `your-anon-key`, `<...>`) from an unfilled `.env.example` copy are treated
// as absent rather than used, so a placeholder never becomes a confusing
// "Invalid API key" from the server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./errors.ts";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Where each value came from, for `nexus whoami` and debugging. */
  source: { url: string; anonKey: string };
}

export const DEFAULT_SUPABASE_URL = "https://efxmzsdisaymtpebaxlp.supabase.co";

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  return s === "" || s.startsWith("<") || s.startsWith("your-") || s === "changeme";
}

/** Minimal .env parser: KEY=value lines, optional quotes, `#` comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function candidateEnvFiles(cwd: string, repoRoot: string): string[] {
  const files: string[] = [];
  if (process.env.NEXUS_ENV_FILE) files.push(process.env.NEXUS_ENV_FILE);
  let dir = path.resolve(cwd);
  for (;;) {
    files.push(path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  files.push(path.join(repoRoot, ".env"));
  files.push(path.join(repoRoot, "apps", "Vault", "Vault", ".env"));
  files.push(path.join(repoRoot, "apps", "PathFinder", ".env"));
  return [...new Set(files)];
}

// `repoRoot` is overridable so tests can run hermetically: the real repo's
// .env files carry a real key and would otherwise satisfy any lookup.
export function loadSupabaseConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), repoRoot = REPO_ROOT): SupabaseConfig {
  let url: string | undefined;
  let anonKey: string | undefined;
  let urlSource = "";
  let keySource = "";

  const take = (u: string | undefined, k: string | undefined, src: string) => {
    if (!url && !isPlaceholder(u)) { url = u!.trim(); urlSource = src; }
    if (!anonKey && !isPlaceholder(k)) { anonKey = k!.trim(); keySource = src; }
  };

  take(env.NEXUS_SUPABASE_URL, env.NEXUS_SUPABASE_ANON_KEY, "env NEXUS_SUPABASE_*");
  take(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, "env VITE_SUPABASE_*");

  const searched = candidateEnvFiles(cwd, repoRoot);
  if (!url || !anonKey) {
    for (const file of searched) {
      if (url && anonKey) break;
      let text: string;
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const vars = parseDotenv(text);
      take(vars.NEXUS_SUPABASE_URL ?? vars.VITE_SUPABASE_URL, vars.NEXUS_SUPABASE_ANON_KEY ?? vars.VITE_SUPABASE_ANON_KEY, file);
    }
  }

  take(DEFAULT_SUPABASE_URL, undefined, "built-in default");

  if (!anonKey) {
    throw new UserError(
      "Supabase anon key not configured: set NEXUS_SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) " +
      `in the environment or in one of: ${searched.join(", ")}`,
    );
  }

  return { url: url!, anonKey, source: { url: urlSource, anonKey: keySource } };
}
