// Moved to packages/nexus-core/src/members.ts so Vault and PathFinder cannot
// drift on a member's name or colour — see that file's header for why the
// previous "duplicated rather than imported" note no longer applies.
//
// Kept as a re-export rather than updating call sites: `memberName` and
// `otherMemberName` are imported from here across the app, and a leaf module
// that forwards costs nothing. Import the deep specifier, never the
// `@nexus/core` barrel, which drags in three.js.
export { memberName, memberColor, otherMemberName, KNOWN_MEMBERS } from "@nexus/core/members";
export type { TeamMemberInfo } from "@nexus/core/members";
