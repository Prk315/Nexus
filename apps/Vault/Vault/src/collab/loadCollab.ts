// The single dynamic-import boundary for the collaboration stack.
//
// Everything heavy (yjs, y-protocols, @tiptap/y-tiptap and the two Tiptap
// collaboration packages) hangs off collabRuntime.ts, which is reached only
// through here. That keeps roughly 700 kB unpacked out of the note bundle for
// anyone with no shared notes, and off the iPad entirely until it's needed.
//
// If you find yourself adding a second `import("./collabRuntime")` somewhere,
// don't — call this instead, so there is one chunk rather than two.
export const loadCollab = () => import("./collabRuntime");
