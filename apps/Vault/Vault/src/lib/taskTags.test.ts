import { describe, it, expect } from "vitest";
import {
  isMissingSchema,
  matchesTags,
  normalizeTag,
  normalizeTagList,
  TAG_MAX_CHARS,
} from "./taskTags";

describe("normalizeTag", () => {
  // The primary key is on the literal text, so two casings would be two rows
  // rendering as one chip — and the filter would match one and miss the other.
  it("lowercases, so one word is one tag", () => {
    expect(normalizeTag("Reading")).toBe("reading");
    expect(normalizeTag("READING")).toBe("reading");
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeTag("  chapter   three  ")).toBe("chapter three");
  });

  it("rejects anything that isn't a usable tag", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("\n\t")).toBeNull();
  });

  it("caps length rather than refusing", () => {
    const long = "a".repeat(TAG_MAX_CHARS + 20);
    expect(normalizeTag(long)).toHaveLength(TAG_MAX_CHARS);
  });
});

describe("normalizeTagList", () => {
  it("dedupes across casing and sorts", () => {
    expect(normalizeTagList(["Reading", "reading", "admin"])).toEqual(["admin", "reading"]);
  });

  it("drops blanks instead of keeping empty tags", () => {
    expect(normalizeTagList(["", "  ", "ok"])).toEqual(["ok"]);
  });

  it("is stable — normalizing an already-normalized list changes nothing", () => {
    const once = normalizeTagList(["B", "a ", "a"]);
    expect(normalizeTagList(once)).toEqual(once);
  });
});

describe("matchesTags", () => {
  const T = ["reading", "thesis"];

  it("matches everything when no tag is selected", () => {
    expect(matchesTags([], [], "any", false)).toBe(true);
    expect(matchesTags(T, [], "all", false)).toBe(true);
  });

  it("any: at least one", () => {
    expect(matchesTags(T, ["reading", "admin"], "any", false)).toBe(true);
    expect(matchesTags(T, ["admin"], "any", false)).toBe(false);
  });

  it("all: every one", () => {
    expect(matchesTags(T, ["reading", "thesis"], "all", false)).toBe(true);
    expect(matchesTags(T, ["reading", "admin"], "all", false)).toBe(false);
  });

  it("none: excludes rather than requires", () => {
    expect(matchesTags(T, ["admin"], "none", false)).toBe(true);
    expect(matchesTags(T, ["reading"], "none", false)).toBe(false);
  });

  // A hard gate, not another AND-ed clause: "untagged AND tagged #reading" is a
  // contradiction, and a filter that can be configured into matching nothing at
  // all is one people conclude is broken.
  it("untaggedOnly overrides the tag list entirely", () => {
    expect(matchesTags([], ["reading"], "any", true)).toBe(true);
    expect(matchesTags(T, ["reading"], "any", true)).toBe(false);
    expect(matchesTags(T, [], "any", true)).toBe(false);
  });
});

describe("isMissingSchema", () => {
  // This is what keeps a task block alive against a database where the tag
  // migration has not been applied — the window between deploying a build and
  // applying the SQL is normal, not an error.
  it("recognises PostgREST's missing-relation and missing-function codes", () => {
    expect(isMissingSchema({ code: "PGRST205" })).toBe(true);
    expect(isMissingSchema({ code: "PGRST202" })).toBe(true);
    expect(isMissingSchema({ code: "42P01" })).toBe(true);
    expect(isMissingSchema({ code: "42883" })).toBe(true);
  });

  it("falls back to the message when the code is unfamiliar", () => {
    expect(isMissingSchema({ message: 'relation "vault_task_tags" does not exist' })).toBe(true);
    expect(isMissingSchema({ message: "Could not find the table in the schema cache" })).toBe(true);
  });

  // Fails loud, never silent: a genuine failure must not be reported as
  // "tags aren't set up", which would hide it behind a migration hint forever.
  it("does not swallow a real error", () => {
    expect(isMissingSchema({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingSchema({ message: "network request failed" })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});
