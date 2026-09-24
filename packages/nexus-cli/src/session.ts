// A signed-in Supabase client for one profile.
//
// The client is created with persistence and auto-refresh OFF: a CLI process
// lives for one command, so the session is restored from the profile file,
// refreshed if it is about to expire, and the fresh tokens written back. No
// timers, no storage adapter, nothing left running when the command returns.
//
// RLS on every table this CLI touches is owner-scoped, so a missing session
// does not error, it returns an EMPTY SET. That is why `requireSession` exits 2
// with the exact login command rather than letting a read proceed and print a
// plausible-looking "nothing here".

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseConfig, type SupabaseConfig } from "./config.ts";
import { AuthError } from "./errors.ts";
import { loginCommandFor, readProfile, writeProfile, type Profile } from "./profiles.ts";

export interface Context {
  profileName: string;
  profile: Profile;
  client: SupabaseClient;
  config: SupabaseConfig;
  userId: string;
}

export function makeClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function profileFromSession(email: string, s: Session): Profile {
  return {
    email,
    user_id: s.user.id,
    refresh_token: s.refresh_token,
    access_token: s.access_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
  };
}

/** Seconds of remaining validity below which the token is refreshed up front. */
const REFRESH_MARGIN_S = 60;

/**
 * Restores the profile's session, refreshing when needed, and persists any new
 * tokens. Throws AuthError (exit 2) with the login command when there is no
 * usable session.
 */
export async function requireSession(profileName: string): Promise<Context> {
  const profile = readProfile(profileName);
  if (!profile) {
    throw new AuthError(`no session for profile "${profileName}": run \`${loginCommandFor(profileName)}\``);
  }
  const config = loadSupabaseConfig();
  const client = makeClient(config);

  const now = Math.floor(Date.now() / 1000);
  const stale = !profile.expires_at || profile.expires_at - now < REFRESH_MARGIN_S;

  let session: Session | null = null;
  if (!stale) {
    const { data, error } = await client.auth.setSession({
      access_token: profile.access_token,
      refresh_token: profile.refresh_token,
    });
    if (!error && data.session) session = data.session;
  }
  if (!session) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: profile.refresh_token });
    if (error || !data.session) {
      throw new AuthError(
        `session for profile "${profileName}" expired or revoked (${error?.message ?? "no session"}): run \`${loginCommandFor(profileName)}\``,
      );
    }
    session = data.session;
  }

  const fresh = profileFromSession(profile.email || session.user.email || "", session);
  if (fresh.access_token !== profile.access_token || fresh.refresh_token !== profile.refresh_token) {
    writeProfile(profileName, fresh);
  }

  return { profileName, profile: fresh, client, config, userId: session.user.id };
}
