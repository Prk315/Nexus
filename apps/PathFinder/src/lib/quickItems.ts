// Quick-list capture and grouping — the pure half of the shopping and chore
// panels in components/QuickPanels.tsx.
//
// A shopping item is a title plus the two `pf_task_shopping` columns (quantity,
// store); a chore is a title plus `pf_task_chores.area`. Typing those into
// separate fields is too slow for a list you fill standing in a kitchen, so the
// one input understands a small shorthand:
//
//   shopping:  "2x milk @netto"   → { title: "milk", quantity: "2", store: "netto" }
//              "500 g flour"      → { title: "flour", quantity: "500 g" }
//              "eggs x12"         → { title: "eggs", quantity: "12" }
//   chores:    "wipe counters #kitchen" → { title: "wipe counters", area: "kitchen" }
//
// The shorthand is deliberately conservative: anything it doesn't recognise
// stays in the title, so the worst case is the old behaviour, never a lost word.

export interface ParsedShopping {
  title: string;
  quantity: string | null;
  store: string | null;
}

export interface ParsedChore {
  title: string;
  area: string | null;
}

const UNIT = "(?:x|×|stk\\.?|pcs|pk|g|kg|ml|cl|dl|l)";
// "2 milk", "2x milk", "500g flour", "1,5 l milk". The unit must be followed by
// whitespace, so "7up" and "3d glasses" stay titles.
const LEADING_QTY = new RegExp(`^(\\d+(?:[.,]\\d+)?)(?:\\s*(${UNIT}))?\\s+(.+)$`, "i");
// "milk x2", "eggs ×12".
const TRAILING_QTY = /^(.+?)\s+[x×]\s?(\d+(?:[.,]\d+)?)$/i;
// "… @ netto" — everything after the LAST '@', so an email-ish title survives
// only if it has no trailing store (acceptable for a shopping list).
const STORE = /^(.*?)\s*@\s*([^@]+?)\s*$/;

export function parseShoppingInput(raw: string): ParsedShopping {
  let rest = raw.trim();
  let store: string | null = null;
  let quantity: string | null = null;

  const s = STORE.exec(rest);
  // Only accept a store when a title remains — "@netto" alone is a title.
  if (s && s[1].trim()) { rest = s[1].trim(); store = s[2].trim(); }

  const lead = LEADING_QTY.exec(rest);
  if (lead) {
    const unit = lead[2] && !/^[x×]$/i.test(lead[2]) ? lead[2] : "";
    quantity = unit ? `${lead[1]} ${unit}` : lead[1];
    rest = lead[3].trim();
  } else {
    const trail = TRAILING_QTY.exec(rest);
    if (trail) { quantity = trail[2]; rest = trail[1].trim(); }
  }

  return { title: rest, quantity, store };
}

const AREA = /(^|\s)#([\p{L}\p{N}_-]+)/u;

export function parseChoreInput(raw: string): ParsedChore {
  const m = AREA.exec(raw);
  if (!m) return { title: raw.trim(), area: null };
  const title = (raw.slice(0, m.index) + m[1] + raw.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  // "#kitchen" alone: keep it as the title rather than create a blank item.
  if (!title) return { title: raw.trim(), area: null };
  return { title, area: m[2] };
}

/** Case- and whitespace-insensitive key, so "Netto" and "netto " are one store. */
export function normKey(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.toLocaleLowerCase() : null;
}

export interface Group<T> {
  /** Normalised key; null is the "no category" bucket. */
  key: string | null;
  /** First-seen spelling, for display. */
  label: string | null;
  items: T[];
}

/**
 * Buckets items by a free-text category (store, area), alphabetically, with the
 * uncategorised bucket LAST. Spellings that differ only by case or surrounding
 * whitespace share a bucket — otherwise one shop splits into two headings with
 * the list divided silently between them.
 */
export function groupByCategory<T>(items: T[], categoryOf: (t: T) => string | null | undefined): Group<T>[] {
  const map = new Map<string | null, Group<T>>();
  for (const it of items) {
    const raw = categoryOf(it);
    const key = normKey(raw);
    let g = map.get(key);
    if (!g) { g = { key, label: key ? raw!.trim() : null, items: [] }; map.set(key, g); }
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key == null) return b.key == null ? 0 : 1;
    if (b.key == null) return -1;
    return a.key.localeCompare(b.key);
  });
}

/** Distinct non-empty values (first spelling wins), sorted — for datalist suggestions. */
export function distinctCategories(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const k = normKey(v);
    if (k && !seen.has(k)) seen.set(k, v!.trim());
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}
