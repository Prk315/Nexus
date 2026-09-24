// Profile storage: ~/.nexus/profiles/<name>.json, mode 0600.
//
// A profile is one signed-in account. Two are in use: `dev` (the Vault sandbox
// account) and `me` (Bastian's personal account, where PathFinder lives). The
// name is printed in every human-readable header so the two are never confused.
//
// Passwords are never stored. Only the tokens Supabase hands back, which the
// session layer refreshes transparently and writes back here.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserError } from "./errors.ts";

export interface Profile {
  email: string;
  user_id: string;
  refresh_token: string;
  access_token: string;
  /** Unix seconds. */
  expires_at: number;
}

export const DEFAULT_PROFILE = "default";

export function profilesDir(): string {
  return process.env.NEXUS_HOME
    ? path.join(process.env.NEXUS_HOME, "profiles")
    : path.join(os.homedir(), ".nexus", "profiles");
}

/** `--profile` beats `NEXUS_PROFILE` beats `default`. */
export function resolveProfileName(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const name = flag ?? env.NEXUS_PROFILE ?? DEFAULT_PROFILE;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new UserError(`invalid profile name "${name}": use letters, digits, dot, dash or underscore`);
  }
  return name;
}

export function profilePath(name: string): string {
  return path.join(profilesDir(), `${name}.json`);
}

export function readProfile(name: string): Profile | null {
  let text: string;
  try {
    text = fs.readFileSync(profilePath(name), "utf8");
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(text);
    if (!p || typeof p !== "object" || typeof p.refresh_token !== "string" || typeof p.user_id !== "string") {
      return null;
    }
    return p as Profile;
  } catch {
    return null;
  }
}

export function writeProfile(name: string, profile: Profile): string {
  const dir = profilesDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = profilePath(name);
  // Write-then-rename so a crash mid-write cannot leave a half-written
  // profile that then reads as "not signed in".
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return file;
}

export function deleteProfile(name: string): boolean {
  try {
    fs.unlinkSync(profilePath(name));
    return true;
  } catch {
    return false;
  }
}

export function listProfiles(): string[] {
  try {
    return fs
      .readdirSync(profilesDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

export function loginCommandFor(name: string): string {
  return name === DEFAULT_PROFILE ? "nexus login" : `nexus login --profile ${name}`;
}
