// `nexus` — terminal CLI for the Nexus monorepo.
//
// Wires the real Supabase session into the command modules. The command
// modules themselves take their data layer through a `deps` object so the
// tests can run them against mocks; this file is the only place that knows
// about profiles on disk and network clients.

import { Command, CommanderError } from "commander";
import { createPathfinderApi } from "@nexus/core/pathfinder";
import { loadSupabaseConfig } from "./config.ts";
import { AuthError, exitCodeFor, oneLine, UserError } from "./errors.ts";
import { header, printJson } from "./output.ts";
import { registerPfCommands } from "./pf/commands.ts";
import { deleteProfile, listProfiles, loginCommandFor, profilePath, readProfile, resolveProfileName, writeProfile } from "./profiles.ts";
import { prompt, promptSecret } from "./prompt.ts";
import { makeClient, profileFromSession, requireSession } from "./session.ts";
import { createVaultApi } from "./vault/api.ts";
import { registerVaultCommands } from "./vault/commands.ts";

const program = new Command();

program
  .name("nexus")
  .description("Vault notes and PathFinder tasks from the terminal. Exit codes: 0 ok, 1 user error, 2 auth error.")
  .version("0.1.0")
  .option("-p, --profile <name>", "profile to use (default: $NEXUS_PROFILE or \"default\")")
  .option("--json", "machine-readable output")
  .exitOverride()
  .showSuggestionAfterError(false)
  .configureOutput({
    writeErr: (s) => process.stderr.write(s),
  });

type Opts = { profile?: string; json?: boolean };

// ── auth ─────────────────────────────────────────────────────────────────────

program.command("login")
  .description("sign in interactively (email + password prompt) and store the session for a profile")
  .action(async (_o, cmd: Command) => {
    const { profile: flag, json } = cmd.optsWithGlobals<Opts>();
    const name = resolveProfileName(flag);
    const config = loadSupabaseConfig();
    const email = await prompt(`email for profile "${name}": `);
    if (!email) throw new UserError("email must not be empty");
    const password = await promptSecret("password: ");
    if (!password) throw new UserError("password must not be empty");
    const client = makeClient(config);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new AuthError(`login failed: ${error?.message ?? "no session returned"}`);
    const profile = profileFromSession(data.session.user.email ?? email, data.session);
    const file = writeProfile(name, profile);
    if (json) return printJson({ profile: name, email: profile.email, user_id: profile.user_id, file });
    process.stdout.write(`${header(name, profile.email, `signed in as ${profile.user_id}`)}\nsaved ${file} (mode 0600)\n`);
  });

program.command("whoami")
  .description("show the profile's account (refreshes the session)")
  .action(async (_o, cmd: Command) => {
    const { profile: flag, json } = cmd.optsWithGlobals<Opts>();
    const name = resolveProfileName(flag);
    const ctx = await requireSession(name);
    const out = {
      profile: name, email: ctx.profile.email, user_id: ctx.userId,
      expires_at: new Date(ctx.profile.expires_at * 1000).toISOString(),
      supabase_url: ctx.config.url, anon_key_source: ctx.config.source.anonKey, file: profilePath(name),
      profiles: listProfiles(),
    };
    if (json) return printJson(out);
    process.stdout.write(
      `${header(name, out.email, `user ${out.user_id}`)}\n` +
      `session expires ${out.expires_at}\nsupabase ${out.supabase_url} (anon key from ${out.anon_key_source})\n` +
      `profile file ${out.file}\nprofiles: ${out.profiles.join(", ") || "-"}\n`,
    );
  });

program.command("logout")
  .description("delete the profile's stored session")
  .action(async (_o, cmd: Command) => {
    const { profile: flag, json } = cmd.optsWithGlobals<Opts>();
    const name = resolveProfileName(flag);
    const existing = readProfile(name);
    if (existing) {
      try {
        const client = makeClient(loadSupabaseConfig());
        await client.auth.setSession({ access_token: existing.access_token, refresh_token: existing.refresh_token });
        await client.auth.signOut({ scope: "local" });
      } catch {
        // Revoking server-side is best effort; the local file is what matters.
      }
    }
    const removed = deleteProfile(name);
    if (json) return printJson({ profile: name, removed });
    process.stdout.write(removed ? `[${name}] signed out, removed ${profilePath(name)}\n` : `[${name}] no session stored (would be ${profilePath(name)}); run \`${loginCommandFor(name)}\` to sign in\n`);
  });

// ── vault + pf ───────────────────────────────────────────────────────────────

registerVaultCommands(program, {
  async open(flag) {
    const name = resolveProfileName(flag);
    const ctx = await requireSession(name);
    return {
      api: createVaultApi(ctx.client, ctx.userId),
      who: { profileName: name, email: ctx.profile.email, userId: ctx.userId },
    };
  },
});

registerPfCommands(program, {
  async open(flag) {
    const name = resolveProfileName(flag);
    const ctx = await requireSession(name);
    return {
      api: createPathfinderApi(ctx.client, () => ctx.userId),
      who: { profileName: name, email: ctx.profile.email, userId: ctx.userId },
      async brief() {
        // The uid is passed explicitly, as the brief skill instructs: with it
        // the function scopes to this user whether or not auth.uid() is set.
        const { data, error } = await ctx.client.rpc("pf_agent_brief", { p_user_id: ctx.userId });
        if (error) throw new UserError(`pf_agent_brief: ${error.message}`);
        return data;
      },
    };
  },
});

// ── run ──────────────────────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof CommanderError) {
    // Help and version exit 0 through here as well; usage errors are 1.
    process.exit(e.exitCode === 0 ? 0 : 1);
  }
  process.stderr.write(`error: ${oneLine(e)}\n`);
  process.exit(exitCodeFor(e));
}
