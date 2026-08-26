// Display names for the two seeded pf_team_members accounts. There is no
// profiles table anywhere in this project (auth.users isn't client-readable),
// so this is a plain hardcoded map — same approach as
// apps/PathFinder/src/lib/api/teams.ts's KNOWN_MEMBERS. Duplicated rather than
// imported: it's two lines, and pulling in PathFinder's api module would drag
// in code that assumes PathFinder's own tables exist.
const KNOWN_MEMBERS: Record<string, string> = {
  "a33625c2-4dd2-44fa-b2e5-4d455eeac59d": "Bastian",
  "870ca14b-2a8a-4634-9c08-2eb2d67207b0": "Josefine",
};

export function memberName(userId: string): string {
  return KNOWN_MEMBERS[userId] ?? userId.slice(0, 8);
}

// With exactly one seeded team of two people, "who am I sharing with" never
// needs a picker or a live pf_team_members query — it's just whichever known
// id isn't mine.
export function otherMemberName(myUserId: string): string {
  const otherId = Object.keys(KNOWN_MEMBERS).find((id) => id !== myUserId);
  return otherId ? KNOWN_MEMBERS[otherId] : "your team";
}
