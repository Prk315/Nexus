// What a card's colour MEANS.
//
// A board already shows status as columns and order as position. A colour is
// the one free channel left, so it is worth choosing what it says rather than
// spending it on decoration — hence a dimension the user picks, not a fixed
// scheme.
//
// ── ⚠️ No value means NO stripe, not a default colour ──────────────────────
//
// A task with no tag, no assignee, no urgency gets nothing. A grey stripe would
// read as a real category — "the grey ones" — and the board would quietly grow
// a group that does not exist. Same rule as everywhere else here: absent is not
// zero. `stripeColor` returns null and the card renders without the channel.
//
// ── Colour separation is checked, not assumed ──────────────────────────────
//
// The scales below vary LIGHTNESS as well as hue. A three-step scale
// distinguished by hue alone (red / amber / green is the obvious one) is the
// classic deuteranopia failure: red and green at the same lightness are the
// same stripe. Every scale here moves in L too, so the order survives with no
// colour vision at all.

import type { PfTask, PfTeamMember } from "@nexus/core/pathfinder";

export const COLOR_BY = ["none", "tag", "priority", "urgency", "assignee"] as const;
export type ColorBy = (typeof COLOR_BY)[number];

export const COLOR_BY_LABELS: Record<ColorBy, string> = {
  none: "No colour",
  tag: "Tag",
  priority: "Priority",
  urgency: "Urgency",
  assignee: "Assignee",
};

/**
 * Low → high, moving in lightness as well as hue so the ORDER is readable
 * without colour vision. Deliberately not red/amber/green at one lightness.
 */
const RANK_SCALE: Record<string, string> = {
  low: "oklch(0.74 0.09 230)",     // pale blue, lightest
  medium: "oklch(0.66 0.14 75)",   // amber, mid
  high: "oklch(0.56 0.20 25)",     // red, darkest
};

/**
 * A stable hue per person.
 *
 * Derived from the id rather than configured: an assignee palette would be one
 * more thing to maintain, and a person joining a team would have no colour
 * until someone assigned them one. Hues are spread on the golden angle so that
 * however many people there are, adjacent ones are far apart.
 */
export function assigneeColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const hue = (h % 360) * 0.618034 * 360 % 360;
  return `oklch(0.64 0.14 ${Math.round(hue)})`;
}

/**
 * The stripe colour for one task, or null when the dimension says nothing
 * about it.
 *
 * `tagColor` is the SHARED resolver — the same word is the same colour in a
 * note, in the tag panel and here. Passing it in rather than reimplementing it
 * is what keeps that true.
 */
export function stripeColor(
  task: PfTask,
  by: ColorBy,
  ctx: {
    tagsOf: (taskId: number) => string[];
    tagColor: (tag: string) => string | undefined;
    members: readonly PfTeamMember[];
  },
): string | null {
  if (by === "none") return null;

  if (by === "tag") {
    // The FIRST tag with a colour, not a blend of all of them. A card with
    // three tags has one stripe, and mixing them produces a fourth colour that
    // is in no legend.
    for (const t of ctx.tagsOf(task.id)) {
      const c = ctx.tagColor(t);
      if (c) return c;
    }
    return null;
  }

  if (by === "priority") return RANK_SCALE[String(task.priority ?? "")] ?? null;
  if (by === "urgency") return RANK_SCALE[String(task.planning?.urgency ?? "")] ?? null;

  // assignee
  //
  // ⚠️ `assigned_to` is documented as meaningless when `team_id` is null, so a
  // personal task gets no stripe rather than a colour for a person who was
  // never assigned. "Everyone" likewise: it is the absence of an assignee, not
  // a person.
  if (!task.team_id) return null;
  const who = task.assigned_to;
  if (who == null || who === "all") return null;
  return assigneeColor(who);
}

/**
 * What the stripe means, for a title attribute.
 *
 * Returned alongside the colour rather than derived from it, because a colour
 * cannot be read back into a label — and a coloured stripe nobody can decode is
 * decoration, which is what this feature exists not to be.
 */
export function stripeLabel(
  task: PfTask,
  by: ColorBy,
  ctx: {
    tagsOf: (taskId: number) => string[];
    tagColor: (tag: string) => string | undefined;
    members: readonly PfTeamMember[];
  },
): string | null {
  if (by === "none") return null;
  if (by === "tag") {
    const t = ctx.tagsOf(task.id).find((x) => ctx.tagColor(x));
    return t ? `#${t}` : null;
  }
  if (by === "priority") return task.priority ? `Priority: ${task.priority}` : null;
  if (by === "urgency") {
    const u = task.planning?.urgency;
    return u ? `Urgency: ${u}` : null;
  }
  if (!task.team_id || task.assigned_to == null || task.assigned_to === "all") return null;
  const m = ctx.members.find((x) => x.user_id === task.assigned_to);
  return m ? m.display_name : "Assigned";
}
