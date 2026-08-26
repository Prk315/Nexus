import { useMemo, useRef, useState } from "react";
import {
  Mail,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  CheckCircle2,
  Plus,
  Clock3,
  Archive,
  ThumbsDown,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "../utils";
import type { MailAxis, MailCategory, MailMessage } from "../mail/types";
import { MAIL_FETCH_LIMIT, type MailLoader, type MailSnapshot } from "../mail/loader";
import type { MailApi } from "../mail/api";
import {
  BUCKET_HEX,
  BUCKET_LABEL,
  groupByBucket,
  plainLine,
  plainText,
  scoreBucket,
  triageInbox,
  type MailTriage,
} from "../mail/score";
import {
  IMPORTANCE_DOT,
  URGENCY_FILL,
  axisSummary,
  normalizeAxis,
} from "../mail/axes";
import { indexCategories, resolveCategory, type ResolvedCategory } from "../mail/categories";
import type { MailRule } from "../mail/types";
import type { MailRulesApi } from "../mail/rulesApi";
import { MailRulesDialog } from "./MailRulesDialog";

/**
 * The Mail dropdown: n8n's Gmail triage, priority-first, with the drafted
 * reply one tap away — in every app that mounts `NexusHeader` *and* has a
 * session to read `mail_messages` with.
 *
 * Shape copied deliberately from `ClockDropdown`: fetch on open, a `useRef`
 * timestamp with a 5-minute TTL, a concurrent-fetch guard, and total silent
 * degradation on failure. No writes, no polling — the header is a read surface.
 *
 * The loader is injected (see `mail/loader.ts`). This component constructs no
 * Supabase client, because the right client here is the app's **authenticated**
 * one and only the app has it.
 */

const REFETCH_AFTER_MS = 5 * 60 * 1000;

export type MailPanelProps = {
  /** Open mail, categories, rules and the freshness signal. See `createMailLoader`. */
  loadMail: MailLoader;
  /**
   * Writes for the rules editor. Optional: without it the panel is read-only
   * and the rules button does not render.
   */
  rulesApi?: MailRulesApi;
  /**
   * Turn a message into a PathFinder task.
   *
   * Injected exactly like `loadMail`, and for the same reason — nexus-core
   * cannot import an app. PathFinder owns the mapping (`importance` →
   * `pf_tasks.priority`, `urgency` → `pf_task_planning.urgency`, and
   * emphatically **not** mail's `category` → `pf_tasks.category`, which is the
   * ISA subtype discriminator). Apps that cannot create tasks pass nothing and
   * the action does not render.
   */
  onConvertToTask?: (message: MailMessage) => Promise<void>;
  /**
   * The two per-message triage writes — "Done" and "Not important". Build one
   * with `createMailApi(supabase)`. Absent means the two row actions do not
   * render, same contract as `onConvertToTask`: a control that cannot write
   * is worse than no control.
   */
  mailApi?: MailApi;
};

// ── Small local helpers ──────────────────────────────────────────────────

/** "3m" / "2h" / "4d" / "21 Aug" — compact enough for a 40px column. */
function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Jane Doe <jane@x.com>" → "Jane Doe"; a bare address stays whole. */
function displaySender(sender: string | null): string {
  const flat = plainLine(sender, 80);
  if (!flat) return "Unknown sender";
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/.exec(flat);
  return named ? named[1].trim() : flat;
}

// ── The two axes, in PathFinder's visual language ────────────────────────

/**
 * Importance is a coloured dot; urgency is a fill-count meter. Two different
 * *forms*, deliberately — see `mail/axes.ts`. Same pair, same order, as
 * `TaskRow` in PathFinder, so someone who uses both apps reads it without
 * relearning.
 *
 * A null axis renders **nothing at all**, exactly as PathFinder omits the
 * urgency meter for a task with no planning row rather than drawing it at 2/3.
 * A greyed-out glyph would still occupy the slot and read as a value.
 */
function ImportanceDot({ importance }: { importance: MailAxis | null }) {
  if (!importance) return null;
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 shrink-0 rounded-full", IMPORTANCE_DOT[importance])}
    />
  );
}

function UrgencyMeter({ urgency }: { urgency: MailAxis | null }) {
  if (!urgency) return null;
  const level = URGENCY_FILL[urgency];
  return (
    <span aria-hidden className="inline-flex h-2.5 shrink-0 items-end gap-[1px]">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] rounded-[1px]",
            i === 1 && "h-1",
            i === 2 && "h-1.5",
            i === 3 && "h-2.5",
            i <= level ? "bg-amber-500" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The pair, plus an explicit marker when the verdict is incomplete.
 *
 * "Half-decided" is its own state and gets its own word. Without it, a message
 * with importance but no urgency is visually identical to one where the
 * urgency glyph just happens to be off-screen.
 */
function AxisPair({ message }: { message: MailMessage }) {
  const importance = normalizeAxis(message.importance);
  const urgency = normalizeAxis(message.urgency);
  const summary = axisSummary(importance, urgency);
  if (!importance && !urgency) return null;
  return (
    <span className="inline-flex items-center gap-1" title={summary} aria-label={summary}>
      <ImportanceDot importance={importance} />
      <UrgencyMeter urgency={urgency} />
      {(!importance || !urgency) && (
        <span className="text-[9px] italic text-muted-foreground/50">part-set</span>
      )}
    </span>
  );
}

function CategoryChip({ category }: { category: ResolvedCategory }) {
  const title =
    category.resolution === "unknown"
      ? `${category.name} — no matching category (renamed or deleted)`
      : category.resolution === "disabled"
        ? `${category.name} — category is disabled`
        : category.colorResolution === "unrecognized"
          ? `${category.name} — colour not recognised`
          : category.name;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[9px] text-muted-foreground",
        // The signal is form, not hue: a broken colour cannot be announced with
        // a colour, because every colour is one a user might have picked.
        category.resolution === "matched" && category.colorResolution === "ok"
          ? "bg-muted"
          : "border border-dashed border-muted-foreground/40",
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: category.hex }}
      />
      {category.emoji ? `${category.emoji} ` : ""}
      {plainLine(category.name, 24)}
      {category.resolution === "disabled" && (
        <span className="text-muted-foreground/50">(off)</span>
      )}
    </span>
  );
}

/** "45m" / "1h 30m" for a minute estimate. */
function fmtEstimate(min: number | null): string {
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return "";
  const h = Math.floor(min / 60);
  const rem = Math.round(min % 60);
  if (h > 0 && rem > 0) return `${h}h ${rem}m`;
  if (h > 0) return `${h}h`;
  return `${rem}m`;
}

/** A due date as a short local date. Empty for anything unparseable. */
function fmtDue(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ── Row ──────────────────────────────────────────────────────────────────

function MailRow({
  message,
  category,
  rule,
  onConvertToTask,
  onMarkDone,
  onMarkNotImportant,
}: {
  message: MailMessage;
  category: ResolvedCategory | null;
  rule: MailRule | null;
  onConvertToTask?: (message: MailMessage) => Promise<void>;
  onMarkDone?: (message: MailMessage) => Promise<void>;
  onMarkNotImportant?: (message: MailMessage) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [demoting, setDemoting] = useState(false);
  const [demoteError, setDemoteError] = useState(false);
  const bucket = scoreBucket(message.score);
  // Every one of these is LLM-authored from arbitrary email content. They are
  // rendered as React children (escaped) and passed through plainText/plainLine
  // first; nothing here ever goes near dangerouslySetInnerHTML.
  const subject = plainLine(message.subject, 120) || "(no subject)";
  const snippet = plainLine(message.snippet, 160);
  const reply = plainText(message.suggested_reply, 1200);
  const due = fmtDue(message.due_date);
  const estimate = fmtEstimate(message.time_estimate);
  const converted = message.task_id !== null;
  // "Not important" is a demotion, not a dismissal — the row stays, dimmed.
  // `sinkLowImportance` (mail/score.ts) is what actually moves it within its
  // bucket; this is only the visual half.
  const notImportant = message.importance === "low";

  async function handleConvert() {
    if (!onConvertToTask || converting || converted) return;
    setConverting(true);
    setConvertError(false);
    try {
      await onConvertToTask(message);
    } catch {
      // The row keeps offering the action; the refetch on next open is what
      // settles whether it actually landed.
      setConvertError(true);
    } finally {
      setConverting(false);
    }
  }

  async function handleMarkDone() {
    if (!onMarkDone || archiving) return;
    setArchiving(true);
    setArchiveError(false);
    try {
      await onMarkDone(message);
      // No `finally`-reset of `archiving` on success: the parent removes this
      // row from the list the moment the status flips (see MailPanel's
      // `updateMessage`), so there is nothing left here to un-disable.
    } catch {
      setArchiveError(true);
      setArchiving(false);
    }
  }

  async function handleMarkNotImportant() {
    if (!onMarkNotImportant || demoting || notImportant) return;
    setDemoting(true);
    setDemoteError(false);
    try {
      await onMarkNotImportant(message);
    } catch {
      setDemoteError(true);
    } finally {
      setDemoting(false);
    }
  }

  return (
    <li
      className={cn(
        "rounded-md px-1.5 py-1.5 hover:bg-accent/50 transition-colors",
        notImportant && "opacity-50 hover:opacity-100",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          title={`${BUCKET_LABEL[bucket]}`}
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: BUCKET_HEX[bucket] }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {displaySender(message.sender)}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
              {fmtWhen(message.received_at)}
            </span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{subject}</p>
          {snippet && (
            <p className="truncate text-[10px] text-muted-foreground/60">{snippet}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <AxisPair message={message} />
            {category && <CategoryChip category={category} />}
            {due && (
              <span className="text-[9px] text-muted-foreground/70" title="Due date">
                due {due}
              </span>
            )}
            {estimate && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/70"
                title="Time estimate"
              >
                <Clock3 className="h-2.5 w-2.5" />
                {estimate}
              </span>
            )}
          </div>

          {/*
            Attribution. "High urgency because <rule>" is the difference between
            a system the user trusts and one that feels arbitrary — and it is
            also the only way to notice a rule that is firing on more than it
            should.
          */}
          {rule && (
            <p className="mt-0.5 truncate text-[9px] text-muted-foreground/60">
              Set by rule “{plainLine(rule.name, 40)}”
            </p>
          )}
          {!rule && message.rule_id && (
            <p className="mt-0.5 text-[9px] text-muted-foreground/60">
              Set by a rule that no longer exists
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {reply ? (
              // A bare <button> inside DropdownMenu.Content is mouse-only:
              // Radix preventDefaults Tab within the content and drives arrow
              // navigation off its Item collection, so an unregistered control
              // has no tab stop at all. Registering as an Item joins that
              // roving focus; `onSelect` preventDefault keeps the menu open
              // instead of closing it the way a real menu command would.
              <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className="inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground transition-colors"
                >
                  {expanded ? (
                    <ChevronDown className="h-2.5 w-2.5" />
                  ) : (
                    <ChevronRight className="h-2.5 w-2.5" />
                  )}
                  Suggested reply
                </button>
              </DropdownMenu.Item>
            ) : (
              <span className="px-1 text-[9px] italic text-muted-foreground/40">
                no draft
              </span>
            )}

            {/* Converted mail must not offer to convert again. */}
            {converted ? (
              <span
                className="inline-flex items-center gap-0.5 px-1 text-[9px] text-emerald-600 dark:text-emerald-400"
                title={`Already a task (#${message.task_id})`}
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Task #{message.task_id}
              </span>
            ) : onConvertToTask ? (
              <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={converting}
                  className="inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground transition-colors disabled:opacity-50"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {converting ? "Creating…" : "Make task"}
                </button>
              </DropdownMenu.Item>
            ) : null}
            {convertError && (
              <span className="text-[9px] italic text-destructive">couldn't create</span>
            )}

            {/* Already demoted: say so instead of offering the action again. */}
            {notImportant ? (
              <span
                className="inline-flex items-center gap-0.5 px-1 text-[9px] text-muted-foreground/50"
                title="Marked not important — sank to the bottom of its priority group"
              >
                <ThumbsDown className="h-2.5 w-2.5" />
                Not important
              </span>
            ) : (
              onMarkNotImportant && (
                <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    onClick={handleMarkNotImportant}
                    disabled={demoting}
                    title="Not important — stays in the list, sinks to the bottom of its priority group"
                    className="inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground transition-colors disabled:opacity-50"
                  >
                    <ThumbsDown className="h-2.5 w-2.5" />
                    {demoting ? "Marking…" : "Not important"}
                  </button>
                </DropdownMenu.Item>
              )
            )}
            {demoteError && (
              <span className="text-[9px] italic text-destructive">couldn't update</span>
            )}

            {onMarkDone && (
              <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                <button
                  type="button"
                  onClick={handleMarkDone}
                  disabled={archiving}
                  title="Done — archives this message, leaves the triage list"
                  className="inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-emerald-600 focus:bg-accent focus:text-emerald-600 transition-colors disabled:opacity-50"
                >
                  <Archive className="h-2.5 w-2.5" />
                  {archiving ? "Archiving…" : "Done"}
                </button>
              </DropdownMenu.Item>
            )}
            {archiveError && (
              <span className="text-[9px] italic text-destructive">couldn't archive</span>
            )}
          </div>

          {expanded && reply && (
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {reply}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────

/**
 * The loader reads a bounded, recency-ordered window. When it comes back full
 * there may be older mail outside it, so say so — otherwise "inbox clear" and
 * the triaged count both read as statements about the whole mailbox when they
 * are only true of the window.
 */
function WindowNotice({ triage }: { triage: MailTriage }) {
  if (triage.total < MAIL_FETCH_LIMIT) return null;
  return (
    <p className="px-1 text-[10px] text-muted-foreground/50">
      Showing the {MAIL_FETCH_LIMIT} most recent messages.
    </p>
  );
}

function TriageList({
  triage,
  categories,
  rules,
  onConvertToTask,
  onMarkDone,
  onMarkNotImportant,
}: {
  triage: MailTriage;
  categories: readonly MailCategory[];
  rules: readonly MailRule[];
  onConvertToTask?: (message: MailMessage) => Promise<void>;
  onMarkDone?: (message: MailMessage) => Promise<void>;
  onMarkNotImportant?: (message: MailMessage) => Promise<void>;
}) {
  // Built once per render rather than per row: a linear scan per message would
  // be O(messages x categories) across a 100-row window.
  const byName = useMemo(() => indexCategories(categories), [categories]);
  const rulesById = useMemo(
    () => new Map(rules.map((r) => [r.id, r])),
    [rules],
  );
  const groups = groupByBucket(triage.pending);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.bucket} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: BUCKET_HEX[group.bucket] }}
            />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            <span className="text-[10px] tabular-nums text-muted-foreground/50">
              {group.messages.length}
            </span>
          </div>
          <ul className="flex flex-col">
            {group.messages.map((m) => (
              <MailRow
                key={m.id}
                message={m}
                category={resolveCategory(m.category, byName)}
                rule={m.rule_id ? (rulesById.get(m.rule_id) ?? null) : null}
                onConvertToTask={onConvertToTask}
                onMarkDone={onMarkDone}
                onMarkNotImportant={onMarkNotImportant}
              />
            ))}
          </ul>
        </div>
      ))}
      {triage.handled.length > 0 && (
        <p className="px-1 text-[10px] text-muted-foreground/50">
          {triage.handled.length} already triaged, hidden.
        </p>
      )}
      <WindowNotice triage={triage} />
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

export function MailPanel({ loadMail, rulesApi, onConvertToTask, mailApi }: MailPanelProps) {
  const [snapshot, setSnapshot] = useState<MailSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const lastFetchRef = useRef(0);

  // Derived, not a parallel state slot: `updateMessage` below only ever
  // touches `snapshot.messages`, and re-deriving here is what makes an
  // optimistic "Done" / "Not important" write show up immediately without a
  // second place that has to remember to stay in sync.
  const triage = useMemo(
    () => (snapshot ? triageInbox(snapshot.messages) : null),
    [snapshot],
  );

  function handleOpenChange(open: boolean) {
    if (!open) return;
    // Same guard as ClockDropdown: a quick open→close→open before the first
    // fetch resolves would otherwise slip past the "already have data" check
    // below and fire a second concurrent read, with whichever response lands
    // last silently winning.
    if (loading) return;
    const now = Date.now();
    if (triage && !failed && now - lastFetchRef.current < REFETCH_AFTER_MS) return;
    lastFetchRef.current = now;
    setLoading(true);
    loadMail()
      .then((result) => {
        setSnapshot(result);
        setFailed(false);
      })
      // Degrade silently, like every other fetch in the header: no crash, no
      // spinner stuck forever. Crucially this state is NOT "no mail" — an
      // unreachable Supabase and an empty inbox must not read the same, for
      // the same reason a missing `blocking_state` row is not "nothing
      // blocked". The last good `triage` is deliberately *kept* rather than
      // cleared: a failed refresh should degrade to stale-but-labelled, not to
      // an inbox that appears to have emptied itself.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  /**
   * Editing rules invalidates the cached snapshot — not because the mail
   * changes (rules are not retroactive; see `RETROACTIVITY_COPY`) but because
   * the *rules themselves* are part of it, and a stale copy would show the
   * editor's own list reverting on reopen.
   */
  function invalidate() {
    lastFetchRef.current = 0;
  }

  /**
   * Patch one row of the cached snapshot in place.
   *
   * This is the whole mechanism behind both triage actions being optimistic:
   * `triage` is derived from `snapshot.messages` above, so writing a patch
   * here — before the network call resolves, and again to roll it back if it
   * fails — is sufficient to move the row between buckets or out of the list
   * entirely. No second "pending changes" structure to keep in sync.
   */
  function updateMessage(id: string, patch: Partial<MailMessage>) {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      };
    });
  }

  /**
   * "Done" → `status: 'archived'`.
   *
   * Applied optimistically: the moment the write is issued the row is already
   * an `isHandled` status, so the very next render moves it out of `pending`
   * and into the "N already triaged, hidden" count — the same code path a
   * real refetch would take, not a special-cased removal. A failed write
   * restores the previous row exactly, which doubles as the undo: there is no
   * separate "Undo" button, but a write that didn't actually land un-does
   * itself rather than leaving the panel showing a state the database
   * disagrees with.
   */
  async function handleMarkDone(message: MailMessage) {
    if (!mailApi) return;
    const previous = message;
    updateMessage(message.id, { status: "archived" });
    try {
      const updated = await mailApi.markDone(message.id);
      if (updated) updateMessage(message.id, updated);
    } catch (e) {
      updateMessage(message.id, previous);
      throw e; // MailRow owns the per-row error label.
    }
  }

  /** "Not important" → `importance: 'low'`. Same optimistic-then-reconcile shape. */
  async function handleMarkNotImportant(message: MailMessage) {
    if (!mailApi) return;
    const previous = message;
    updateMessage(message.id, { importance: "low" });
    try {
      const updated = await mailApi.markNotImportant(message.id);
      if (updated) updateMessage(message.id, updated);
    } catch (e) {
      updateMessage(message.id, previous);
      throw e;
    }
  }

  const pendingCount = triage?.pending.length ?? 0;

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          title="Mail"
          className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Mail className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-[380px] max-h-[75vh] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3",
            "flex flex-col gap-2",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-semibold text-foreground">Mail</p>
            <div className="flex items-center gap-2">
              {triage && pendingCount > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {pendingCount} to triage
                </span>
              )}
              {/*
                Without a write API the editor would be a form that cannot save,
                so the button simply does not exist — same contract as
                `onConvertToTask`.
              */}
              {rulesApi && (
                <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    onClick={() => setRulesOpen(true)}
                    title="Triage rules"
                    className="inline-flex items-center gap-1 rounded-sm px-1 py-px text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground transition-colors"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    Rules
                  </button>
                </DropdownMenu.Item>
              )}
            </div>
          </div>

          {loading && !triage && (
            <p className="px-1 py-2 text-xs italic text-muted-foreground">Loading…</p>
          )}

          {/* Failure — deliberately worded as "can't tell", never as "no mail". */}
          {!loading && failed && (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <p className="text-[11px] font-medium text-foreground">Mail is unavailable.</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                {triage
                  ? "Couldn't refresh — showing the last successful fetch."
                  : "Couldn't reach the mailbox. This is not an empty inbox."}
              </p>
            </div>
          )}

          {/*
            The freshness signal, NOT the row count, decides this one. Zero rows
            means "n8n has never run" *or* "the inbox is clean"; only the newest
            completed `mail_sync` request can tell them apart, and a missing one
            is *unknown* rather than empty.
          */}
          {!loading && snapshot && snapshot.lastSyncedAt === null && (
            <div className="px-1 py-2">
              <p className="text-xs italic text-muted-foreground">Never synced.</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                n8n has not completed a mail sync. This is not an empty inbox — nothing
                is known about it yet.
              </p>
            </div>
          )}

          {/* Synced, and nothing open: genuinely clear. */}
          {!loading && snapshot?.lastSyncedAt && triage && pendingCount === 0 && (
            <div className="px-1 py-2">
              <p className="text-xs italic text-muted-foreground">Inbox clear.</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                Nothing left to triage as of the last sync.
              </p>
            </div>
          )}

          {!loading && triage && pendingCount > 0 && (
            <TriageList
              triage={triage}
              categories={snapshot?.categories ?? []}
              rules={snapshot?.rules ?? []}
              onConvertToTask={onConvertToTask}
              onMarkDone={mailApi ? handleMarkDone : undefined}
              onMarkNotImportant={mailApi ? handleMarkNotImportant : undefined}
            />
          )}

          {/* Footer: when the pipeline last actually ran. An unparseable
              timestamp yields "", so render nothing rather than a dangling
              "Synced". */}
          {!loading && fmtWhen(snapshot?.lastSyncedAt ?? null) !== "" && (
            <p className="border-t border-border px-1 pt-1.5 text-[10px] text-muted-foreground/50">
              Synced {fmtWhen(snapshot?.lastSyncedAt ?? null)}
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>

      {/*
        Rendered as a sibling of the dropdown, not inside its Content: the
        dropdown closes on outside-pointer-down, and a dialog nested in it would
        be torn down by its own first click.
      */}
      {rulesApi && (
        <MailRulesDialog
          open={rulesOpen}
          onOpenChange={(o) => { setRulesOpen(o); if (!o) invalidate(); }}
          rules={snapshot?.rules ?? []}
          categories={snapshot?.categories ?? []}
          api={rulesApi}
          onChanged={invalidate}
        />
      )}
    </DropdownMenu.Root>
  );
}
