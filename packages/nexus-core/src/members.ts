// ─── Team member identity ────────────────────────────────────────────────────
// One account is universal across the ecosystem (see auth/NexusAuth.tsx), but
// there is no profiles table and `auth.users` is not client-readable, so a uid
// can only be turned into a human name by a hardcoded map. This module is that
// map, for every app.
//
// It lives in nexus-core rather than being copied per app because a THIRD
// field just arrived. Vault's live co-editing carets need a per-user colour,
// and a colour is exactly the kind of thing that must agree across apps: if
// Vault and PathFinder disagree about Josefine's name that's a nuisance, but
// if they disagree about her colour then the same person is visually a
// different person in each app, which is worse than having no colour at all.
//
// Import it as the deep specifier `@nexus/core/members`, never via the
// `@nexus/core` barrel — the barrel pulls in three.js. Same reasoning as the
// existing `@nexus/core/coverage` and `@nexus/core/categories` aliases.
//
// This replaces two hand-maintained copies: apps/Vault/Vault/src/lib/
// teamMembers.ts and apps/PathFinder/src/lib/api/teams.ts's KNOWN_MEMBERS.
// Vault's copy carried a comment defending the duplication ("pulling in
// PathFinder's api module would drag in code that assumes PathFinder's own
// tables exist"). That objection was correct and is answered rather than
// ignored: this is a leaf module that imports nothing at all.

export interface TeamMemberInfo {
  name: string;
  /**
   * MUST be 6-digit hex. `@tiptap/y-tiptap` validates collaboration-caret
   * colours against /^#[0-9a-fA-F]{6}$/ and console.warns on anything else, so
   * shorthand (#f00) and rgba() are both rejected there.
   */
  color: string;
}

// Blue and orange rather than two hues from the same ramp. These are rendered
// as the *only* thing distinguishing one person's caret and text selection
// from another's, so they have to survive red-green colour blindness — the
// indigo→fuchsia pairing used elsewhere in the ecosystem does not.
export const KNOWN_MEMBERS: Record<string, TeamMemberInfo> = {
  "a33625c2-4dd2-44fa-b2e5-4d455eeac59d": { name: "Bastian", color: "#2563eb" },
  "870ca14b-2a8a-4634-9c08-2eb2d67207b0": { name: "Josefine", color: "#ea580c" },
};

// Picked so an unknown uid still lands on something legible against both the
// light and dark editor backgrounds. Never generate a colour channel-wise from
// a hash: that reaches near-white and near-black, and a caret you cannot see
// reads as "collaboration is broken".
const FALLBACK_COLORS = [
  "#0d9488", // teal-600
  "#c026d3", // fuchsia-600
  "#65a30d", // lime-600
  "#dc2626", // red-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
];

export function memberName(userId: string): string {
  return KNOWN_MEMBERS[userId]?.name ?? userId.slice(0, 8);
}

/** Always a 6-digit hex string, for known and unknown uids alike. */
export function memberColor(userId: string): string {
  const known = KNOWN_MEMBERS[userId];
  if (known) return known.color;
  // Deterministic so the same person keeps the same colour across sessions and
  // devices without any storage. djb2 over the uid.
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// With exactly one seeded team of two people, "who am I sharing with" never
// needs a picker or a live pf_team_members query — it's just whichever known
// id isn't mine.
export function otherMemberName(myUserId: string): string {
  const otherId = Object.keys(KNOWN_MEMBERS).find((id) => id !== myUserId);
  return otherId ? KNOWN_MEMBERS[otherId].name : "your team";
}
