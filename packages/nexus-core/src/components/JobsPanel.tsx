import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
  Power,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "../utils";
// Reused, not re-implemented. `plainText` strips C0/C1 controls plus the
// zero-width and bidi format characters — an RLO in a scraped company name is
// the same "invoice‮gnp.exe" spoof it is in a subject line, and everything
// rendered here is either scraped HTML or LLM output. A second copy of that
// character class would be a second thing to get wrong.
import { plainLine, plainText } from "../mail/score";
import {
  MATCH_LIMIT,
  REVIEW_LIMIT,
  SENT_LIMIT,
  type JobsApi,
  type JobsSnapshot,
} from "../jobs/api";
import {
  BAND_HEX,
  BAND_INK,
  BAND_LABEL,
  applicationGaps,
  moduleNeedsText,
  scoreBand,
  normalizeScore,
} from "../jobs/score";
import type { JobAppModule, JobApplicationItem, JobMatchItem } from "../jobs/types";

/**
 * The Jobs dropdown: the harvest → gate → score → assemble pipeline's one human
 * checkpoint, in every app that mounts `NexusHeader` *and* has a session.
 *
 * Same contract as `MailPanel` in every respect that matters: the API is
 * injected (nexus-core builds no Supabase client — see `jobs/api.ts`), the panel
 * fetches on open behind a TTL, and it degrades to *stale-and-labelled* rather
 * than to an empty list. The one addition is a count poll while closed, because
 * a badge that only appears after you have already opened the panel is not a
 * notification.
 *
 * ⚠️ The empty state branches on **whether an API was passed**, never on row
 * count. These tables are `auth.uid()`-scoped with no anon policy, so a
 * signed-out read returns `[]` — identical to "nothing matched". Apps withhold
 * the API when there is no session and the panel says "sign in" instead.
 */

const REFETCH_AFTER_MS = 5 * 60 * 1000;
/** The badge poll. Matches the header's other pollers; cheap (`head: true`). */
const COUNT_POLL_MS = 60 * 1000;

export type JobsPanelProps = {
  /**
   * Reads and the two guarded writes. See `createJobsApi`.
   *
   * **Absent means "no session"**, and the panel says exactly that. It does not
   * mean "no jobs" and must never be made to render as such.
   */
  api?: JobsApi;
};

type Tab = "review" | "matches" | "sent" | "modules";

const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "matches", label: "Matches" },
  { id: "sent", label: "Sent" },
  { id: "modules", label: "Modules" },
];

// ── Small local helpers ──────────────────────────────────────────────────

/** "2h ago" / "4d ago" / "21 Aug". Empty string for anything unparseable. */
function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A deadline as a short local date, plus whether it has already passed. */
function deadline(iso: string | null): { text: string; past: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return {
    text: new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    past: t < Date.now(),
  };
}

// ── Score badge ──────────────────────────────────────────────────────────

/**
 * The number, or an explicit pending marker — **never** a zero.
 *
 * `score` is null until the model has looked, and n8n stops when the Mac
 * sleeps, so unevaluated is the normal overnight state. Rendering that as `0`
 * would say "we looked and it is a terrible fit" about a job nobody has read.
 */
function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "sm" }) {
  const band = scoreBand(score);
  const value = normalizeScore(score);
  return (
    <span
      title={value === null ? BAND_LABEL.pending : `${BAND_LABEL[band]} — ${value}/100`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-bold tabular-nums leading-none",
        size === "md" ? "h-6 min-w-[30px] px-1.5 text-[12px]" : "h-5 min-w-[26px] px-1 text-[11px]",
      )}
      style={{ backgroundColor: BAND_HEX[band], color: BAND_INK[band] }}
    >
      {value === null ? "…" : value}
    </span>
  );
}

// ── Skill chips ──────────────────────────────────────────────────────────

const CHIP_CAP = 6;

function SkillChips({
  matched,
  missing,
}: {
  matched: string[];
  missing: string[];
}) {
  const have = (matched ?? []).filter(Boolean);
  const lack = (missing ?? []).filter(Boolean);
  if (have.length === 0 && lack.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {have.slice(0, CHIP_CAP).map((s) => (
        <span
          key={`h-${s}`}
          className="inline-flex items-center gap-0.5 rounded-sm bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:text-emerald-300"
        >
          <Check className="h-2.5 w-2.5" />
          {plainLine(s, 22)}
        </span>
      ))}
      {have.length > CHIP_CAP && (
        <span className="text-[9px] text-muted-foreground/60">+{have.length - CHIP_CAP}</span>
      )}
      {lack.slice(0, CHIP_CAP).map((s) => (
        <span
          key={`m-${s}`}
          title="Not evidenced by the application"
          className="inline-flex items-center gap-0.5 rounded-sm border border-dashed border-rose-500/50 px-1.5 py-px text-[9px] text-rose-600 dark:text-rose-400"
        >
          <X className="h-2.5 w-2.5" />
          {plainLine(s, 22)}
        </span>
      ))}
      {lack.length > CHIP_CAP && (
        <span className="text-[9px] text-muted-foreground/60">+{lack.length - CHIP_CAP}</span>
      )}
    </div>
  );
}

// ── The gap banner ───────────────────────────────────────────────────────

/**
 * Loud on purpose.
 *
 * A draft with a `[GAP: …]` marker or an uncovered slot is one keystroke away
 * from being sent to an employer with the word GAP in it. This is the surface
 * where that gets caught, so it is a filled amber bar and not a grey footnote —
 * the same reasoning as the visible-gap design itself: plausible-looking output
 * is worse than visibly absent output.
 */
function GapBanner({ slots, marker, empty }: { slots: string[]; marker: boolean; empty: boolean }) {
  const reasons: string[] = [];
  if (empty) reasons.push("the draft is empty");
  if (slots.length > 0) {
    reasons.push(`no module for ${slots.map((s) => `‘${plainLine(s, 20)}’`).join(", ")}`);
  }
  if (marker) reasons.push("the body still has a [GAP/TODO] marker");
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-1.5">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Not ready to send
        </p>
        <p className="text-[10px] leading-snug text-amber-800/90 dark:text-amber-200/80">
          {reasons.join("; ")}. Write the module in the Modules tab, or edit the draft.
        </p>
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────

/** A menu-registered toggle. See the `DropdownMenu.Item asChild` note below. */
function MenuButton({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // A bare <button> inside DropdownMenu.Content is mouse-only: Radix
  // preventDefaults Tab within the content and drives arrow navigation off its
  // Item collection, so an unregistered control has no tab stop at all.
  // Registering as an Item joins that roving focus; `onSelect` preventDefault
  // keeps the menu open instead of closing it the way a real command would.
  return (
    <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          "inline-flex items-center gap-1 rounded-md outline-none transition-colors disabled:opacity-50",
          className,
        )}
      >
        {children}
      </button>
    </DropdownMenu.Item>
  );
}

function PostingLink({ url, label }: { url: string | null | undefined; label?: string }) {
  if (!url) return null;
  return (
    <DropdownMenu.Item asChild>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[9px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground"
      >
        <ExternalLink className="h-2.5 w-2.5" />
        {label ?? "Posting"}
      </a>
    </DropdownMenu.Item>
  );
}

function Disclosure({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <MenuButton
      onClick={onToggle}
      className="px-1 py-px text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground"
    >
      {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
      {label}
    </MenuButton>
  );
}

/**
 * "Showing the N most recent" — a bounded window must never read as a whole list.
 *
 * Driven by the loader's own `truncated` flag rather than by re-deriving
 * `rows.length >= cap` here, so there is one place that decides it. Same reason
 * `MailPanel`'s notice reads `MAIL_FETCH_LIMIT` from the loader module.
 */
function WindowNotice({ truncated, cap, noun }: { truncated: boolean; cap: number; noun: string }) {
  if (!truncated) return null;
  return (
    <p className="px-1 pt-1 text-[10px] text-muted-foreground/50">
      Showing the {cap} most recent {noun}. There may be more.
    </p>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-1 py-4 text-center">
      <p className="text-xs italic text-muted-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-[300px] text-[10px] leading-snug text-muted-foreground/60">
        {detail}
      </p>
    </div>
  );
}

// ── Review ───────────────────────────────────────────────────────────────

type Decision = "approved" | "cancelled" | "raced";

function ReviewCard({
  item,
  decision,
  busy,
  error,
  onApprove,
  onReject,
}: {
  item: JobApplicationItem;
  decision: Decision | undefined;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [openDraft, setOpenDraft] = useState(false);
  const gaps = applicationGaps(item);
  const empty = !item.body || item.body.trim() === "";
  const title = plainLine(item.posting?.title, 90) || "(untitled posting)";
  const company = plainLine(item.posting?.company, 50);
  const location = plainLine(item.posting?.location, 40);
  const profile = plainLine(item.profile?.name, 30);
  const due = deadline(item.posting?.valid_through ?? null);
  const body = plainText(item.body, 8000);

  // Decided this session: the card collapses to a one-line receipt rather than
  // disappearing, so the click has visible consequence before the refetch lands.
  if (decision) {
    return (
      <li
        className={cn(
          "flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px]",
          decision === "approved" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          decision === "cancelled" && "border-border bg-muted/40 text-muted-foreground",
          decision === "raced" && "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
      >
        {decision === "approved" && <Check className="h-3 w-3 shrink-0" />}
        {decision === "cancelled" && <X className="h-3 w-3 shrink-0" />}
        {decision === "raced" && <AlertTriangle className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-medium">
          {decision === "approved" && "Approved — queued to send"}
          {decision === "cancelled" && "Rejected"}
          {/* Not an error. The email link decided it first; both writes are
              guarded on `status = needs_approval` precisely so the second one
              is a no-op instead of a second decision. */}
          {decision === "raced" && "Already decided elsewhere"}
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card/40 p-2 transition-colors hover:border-border/80 hover:bg-accent/30">
      <div className="flex items-start gap-2">
        <ScoreBadge score={item.match?.score ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-tight text-foreground">
            {title}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {[company, location].filter(Boolean).join(" · ") || "Company unknown"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {profile && (
              <span className="rounded-sm bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
                {profile}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground/60">
              {ago(item.approval_requested_at) || ago(item.updated_at)}
            </span>
            {due && (
              <span
                className={cn(
                  "text-[9px] font-medium",
                  due.past ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/70",
                )}
                title={due.past ? "The stated deadline has passed" : "Application deadline"}
              >
                {due.past ? `closed ${due.text}` : `closes ${due.text}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {item.match && (
        <SkillChips matched={item.match.matched_skills} missing={item.match.missing_skills} />
      )}

      {gaps.blocked && (
        <GapBanner slots={gaps.slots} marker={gaps.markerInBody} empty={empty} />
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {body ? (
          <Disclosure
            open={openDraft}
            onToggle={() => setOpenDraft((o) => !o)}
            label={openDraft ? "Hide draft" : "Read draft"}
          />
        ) : (
          <span className="px-1 text-[9px] italic text-muted-foreground/50">no body assembled</span>
        )}
        <PostingLink url={item.posting?.url} />
        {item.module_ids.length > 0 && (
          <span className="text-[9px] text-muted-foreground/50">
            {item.module_ids.length} module{item.module_ids.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {openDraft && body && (
        <pre className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-sans text-[10px] leading-relaxed text-muted-foreground">
          {body}
        </pre>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <MenuButton
          onClick={onApprove}
          disabled={busy}
          title="Approve — the sender picks it up on its next pass"
          className="h-7 flex-1 justify-center bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-500 focus:bg-emerald-500"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Approve
        </MenuButton>
        <MenuButton
          onClick={onReject}
          disabled={busy}
          title="Reject — the draft is kept, cancelled"
          className="h-7 justify-center border border-border px-3 text-[11px] font-medium text-muted-foreground hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <X className="h-3 w-3" />
          Reject
        </MenuButton>
      </div>

      {error && <p className="mt-1 text-[9px] italic text-destructive">{error}</p>}
    </li>
  );
}

// ── Matches ──────────────────────────────────────────────────────────────

function MatchRow({ item }: { item: JobMatchItem }) {
  const [open, setOpen] = useState(false);
  const title = plainLine(item.posting?.title, 90) || "(untitled posting)";
  const company = plainLine(item.posting?.company, 50);
  const profile = plainLine(item.profile?.name, 30);
  const reasoning = plainText(item.reasoning, 2000);
  const pending = normalizeScore(item.score) === null;

  return (
    <li className="rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/50">
      <div className="flex items-start gap-2">
        <ScoreBadge score={item.score} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-foreground">{title}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {company || "Company unknown"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {profile && (
              <span className="rounded-sm bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                {profile}
              </span>
            )}
            {/* "Pending" is a state with its own word. An unevaluated match with
                no `evaluated_at` would otherwise render as a blank timestamp,
                which reads like a rendering bug rather than a fact. */}
            {pending ? (
              <span className="rounded-sm bg-violet-500/15 px-1.5 py-px text-[9px] font-medium text-violet-600 dark:text-violet-300">
                awaiting the model
              </span>
            ) : (
              <span className="text-[9px] text-muted-foreground/60">{ago(item.evaluated_at)}</span>
            )}
          </div>
          {(reasoning || item.matched_skills.length > 0 || item.missing_skills.length > 0) && (
            <div className="mt-1">
              <Disclosure open={open} onToggle={() => setOpen((o) => !o)} label="Why" />
            </div>
          )}
          {open && (
            <div className="mt-1">
              <SkillChips matched={item.matched_skills} missing={item.missing_skills} />
              {reasoning && (
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  {reasoning}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0">
          <PostingLink url={item.posting?.url} label="" />
        </div>
      </div>
    </li>
  );
}

// ── Sent ─────────────────────────────────────────────────────────────────

type StatusTone = "good" | "bad" | "neutral" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  bad: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
  neutral: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40",
  muted: "bg-muted text-muted-foreground border-border",
};

/**
 * The status chip.
 *
 * `status` is free text in the database, so the default branch is load-bearing
 * rather than defensive decoration: an unrecognised value renders as itself in
 * a neutral chip. Dropping the row — or, worse, defaulting it to "submitted" —
 * would make a pipeline change invisible from here.
 */
function statusChip(item: JobApplicationItem): { tone: StatusTone; label: string; detail: string } {
  switch (item.status) {
    case "submitted":
      return { tone: "good", label: "Sent", detail: ago(item.submitted_at) };
    case "failed":
      return {
        tone: "bad",
        label: "Failed",
        detail: plainLine(item.fail_reason, 90) || "no reason recorded",
      };
    case "approved":
      return { tone: "neutral", label: "Approved", detail: "waiting to send" };
    case "queued":
      return { tone: "neutral", label: "Queued", detail: "waiting to send" };
    case "cancelled":
      return { tone: "muted", label: "Rejected", detail: ago(item.updated_at) };
    case "expired":
      return { tone: "muted", label: "Expired", detail: "the deadline passed first" };
    default:
      return { tone: "muted", label: plainLine(item.status, 24) || "unknown", detail: "" };
  }
}

function SentRow({ item }: { item: JobApplicationItem }) {
  const chip = statusChip(item);
  const title = plainLine(item.posting?.title, 80) || "(untitled posting)";
  const company = plainLine(item.posting?.company, 44);
  const profile = plainLine(item.profile?.name, 24);
  return (
    <li className="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/50">
      <span
        className={cn(
          "mt-px inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
          TONE_CLASS[chip.tone],
        )}
      >
        {chip.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-foreground">{title}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {[company, profile].filter(Boolean).join(" · ") || "—"}
        </p>
        {chip.detail && (
          <p
            className={cn(
              "mt-0.5 text-[9px]",
              chip.tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/60",
            )}
          >
            {chip.detail}
          </p>
        )}
      </div>
      <div className="shrink-0">
        <PostingLink url={item.posting?.url} label="" />
      </div>
    </li>
  );
}

// ── Modules ──────────────────────────────────────────────────────────────

function ModuleRow({
  module: m,
  onToggle,
  onSave,
}: {
  module: JobAppModule;
  onToggle: (enabled: boolean) => Promise<void>;
  onSave: (content: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsText = moduleNeedsText(m);
  const dirty = draft !== m.content;
  const serverRef = useRef(m.content);

  /**
   * Adopt a changed stored value — but only when there is nothing unsaved.
   *
   * The row keeps its identity across a refetch (keyed by `id`), so a plain
   * `setDraft(m.content)` here would wipe half-typed text every time the panel
   * refreshed. Comparing against the *previously seen* server value is what
   * distinguishes "someone else changed this" from "I have unsaved edits":
   * after our own save the two coincide and this is a no-op.
   */
  useEffect(() => {
    if (m.content === serverRef.current) return;
    const untouched = draft === serverRef.current;
    serverRef.current = m.content;
    if (untouched) setDraft(m.content);
  }, [m.content, draft]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn(
        "rounded-md border px-2 py-1.5 transition-colors",
        needsText
          ? "border-amber-500/60 bg-amber-500/10"
          : m.enabled
            ? "border-border bg-card/30"
            : "border-dashed border-border bg-transparent",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] font-medium",
            m.enabled ? "text-foreground" : "text-muted-foreground line-through",
          )}
        >
          {plainLine(m.name, 60)}
        </span>
        {needsText && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-amber-500/25 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-2.5 w-2.5" />
            needs your text
          </span>
        )}
        <MenuButton
          onClick={() => void run(() => onToggle(!m.enabled))}
          disabled={busy}
          title={m.enabled ? "Disable — the assembler stops using it" : "Enable"}
          className={cn(
            "h-5 shrink-0 px-1.5 text-[9px] font-medium",
            m.enabled
              ? "bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-300"
              : "bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          <Power className="h-2.5 w-2.5" />
          {m.enabled ? "on" : "off"}
        </MenuButton>
        <MenuButton
          onClick={() => setOpen((o) => !o)}
          title="Edit content"
          className="h-5 shrink-0 px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-2.5 w-2.5" />
        </MenuButton>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        <span className="rounded-sm bg-muted px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
          {plainLine(m.slot, 20)}
        </span>
        <span className="text-[9px] uppercase text-muted-foreground/50">{plainLine(m.lang, 5)}</span>
        {(m.tags ?? []).slice(0, 5).map((t) => (
          <span key={t} className="text-[9px] text-muted-foreground/60">
            #{plainLine(t, 18)}
          </span>
        ))}
      </div>

      {!open && (
        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground/70">
          {plainLine(m.content, 140) || "(empty)"}
        </p>
      )}

      {open && (
        <div className="mt-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            spellCheck
            // ⚠️ Radix's menu typeahead lives on `DropdownMenu.Content`'s
            // `onKeyDown` and fires for **any** single character keydown that
            // bubbles up to it — so without this, typing "a" here jumps focus to
            // the first item starting with "a" and the textarea is unusable.
            // Escape still closes the panel: `DismissableLayer` listens on the
            // document in the capture phase, which this never sees.
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full resize-y rounded-md border border-border bg-background p-2 text-[10px] leading-relaxed text-foreground outline-none focus:border-ring"
            placeholder="The paragraph, written by you. Stored verbatim, concatenated verbatim."
          />
          <div className="mt-1 flex items-center gap-1.5">
            <MenuButton
              onClick={() => void run(async () => { await onSave(draft); })}
              disabled={busy || !dirty}
              className="h-6 bg-foreground px-2 text-[10px] font-semibold text-background hover:opacity-90"
            >
              {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
              Save
            </MenuButton>
            <MenuButton
              onClick={() => setDraft(m.content)}
              disabled={busy || !dirty}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Revert
            </MenuButton>
            {error && <span className="text-[9px] italic text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

export function JobsPanel({ api }: JobsPanelProps) {
  const [snapshot, setSnapshot] = useState<JobsSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("review");
  const [badge, setBadge] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busyIds, setBusyIds] = useState<Record<string, true>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lastFetchRef = useRef(0);

  const fetchSnapshot = useCallback(
    (force: boolean) => {
      if (!api) return;
      // Same guard as MailPanel/ClockDropdown: a quick open→close→open before
      // the first fetch resolves would otherwise slip past the freshness check
      // below and fire a second concurrent read, with whichever response lands
      // last silently winning.
      if (loading) return;
      const now = Date.now();
      if (!force && snapshot && !failed && now - lastFetchRef.current < REFETCH_AFTER_MS) return;
      lastFetchRef.current = now;
      setLoading(true);
      api
        .load()
        .then((result) => {
          setSnapshot(result);
          setFailed(false);
          // A landed refetch is the authority on what happened; the optimistic
          // receipts have served their purpose and would otherwise linger over
          // rows the server has already moved on.
          setDecisions({});
          setBadge(result.review.length);
        })
        // Degrade silently, like every other fetch in the header. Crucially this
        // is NOT "no jobs": the last good snapshot is deliberately *kept* rather
        // than cleared, so a failed refresh reads as stale-but-labelled instead
        // of as a review queue that emptied itself.
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    },
    [api, loading, snapshot, failed],
  );

  /**
   * The badge poll.
   *
   * `MailPanel` has no equivalent — it fetches on open only, so its dot cannot
   * appear until you have already looked. That is fine for mail, which you open
   * anyway; it is not fine for an approval queue whose entire job is to tell you
   * something is waiting. This is a `head: true` count, so it costs one row-less
   * request a minute and never touches a draft body.
   *
   * A failed count leaves the previous number in place rather than zeroing it —
   * "can't tell" must not render as "nothing waiting".
   */
  useEffect(() => {
    if (!api) {
      setBadge(null);
      return;
    }
    let active = true;
    const tick = () => {
      api
        .countNeedsApproval()
        .then((n) => {
          if (active) setBadge(n);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, COUNT_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [api]);

  function handleOpenChange(open: boolean) {
    if (!open) return;
    fetchSnapshot(false);
  }

  async function decide(id: string, kind: "approve" | "reject") {
    if (!api || busyIds[id]) return;
    setBusyIds((b) => ({ ...b, [id]: true }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    try {
      const row = kind === "approve" ? await api.approve(id) : await api.reject(id);
      // `null` means the guarded update matched no row — the email link decided
      // it first. Not an error, and emphatically not a silent success: the card
      // says so, because "I clicked approve and nothing visible happened" is how
      // someone ends up clicking it four more times.
      setDecisions((d) => ({
        ...d,
        [id]: row === null ? "raced" : kind === "approve" ? "approved" : "cancelled",
      }));
      setBadge((n) => (typeof n === "number" && n > 0 ? n - 1 : n));
      // Refetch so the row lands in Sent with whatever the server actually did.
      lastFetchRef.current = 0;
      setTimeout(() => fetchSnapshot(true), 400);
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: e instanceof Error ? e.message : "couldn't save" }));
    } finally {
      setBusyIds(({ [id]: _drop, ...rest }) => rest);
    }
  }

  const modulesBySlot = useMemo(() => {
    const groups = new Map<string, JobAppModule[]>();
    for (const m of snapshot?.modules ?? []) {
      const slot = m.slot || "unslotted";
      const list = groups.get(slot);
      if (list) list.push(m);
      else groups.set(slot, [m]);
    }
    return [...groups.entries()];
  }, [snapshot?.modules]);

  const moduleWarnings = useMemo(
    () => (snapshot?.modules ?? []).filter((m) => moduleNeedsText(m)).length,
    [snapshot?.modules],
  );

  const counts: Record<Tab, number | null> = {
    review: snapshot ? snapshot.review.length : badge,
    matches: snapshot ? snapshot.matches.length : null,
    sent: snapshot ? snapshot.sent.length : null,
    modules: snapshot ? snapshot.modules.length : null,
  };

  const pending = badge ?? snapshot?.review.length ?? 0;

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          title={pending > 0 ? `${pending} application${pending === 1 ? "" : "s"} to review` : "Jobs"}
          className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Briefcase className="h-4 w-4" />
          {pending > 0 && (
            // Amber, not mail's red: this is "a decision is waiting on you",
            // which is a different feeling from "unread". A number rather than a
            // dot, because the useful question is how big the queue is.
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-none text-black tabular-nums">
              {pending > 99 ? "99+" : pending}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-[420px] max-h-[78vh] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3",
            "flex flex-col gap-2",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-semibold text-foreground">Job search</p>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />}
          </div>

          {/*
            No session → no read is attempted at all. This branch exists because
            these tables are `auth.uid()`-scoped with no anon policy: a
            signed-out read returns [] rather than an error, so row count can
            never tell "nothing matched" from "not signed in". The app withholds
            the API; the panel says which one it is.
          */}
          {!api ? (
            <EmptyState
              title="Sign in to see your job search."
              detail="Postings, drafts and your application modules are private to your account, so nothing can be read without a session."
            />
          ) : (
            <>
              {/* Segmented control */}
              <div className="flex items-center gap-0.5 rounded-lg bg-muted/70 p-0.5">
                {TABS.map((t) => {
                  const active = t.id === tab;
                  const n = counts[t.id];
                  const warn = t.id === "modules" && moduleWarnings > 0;
                  return (
                    <DropdownMenu.Item asChild key={t.id} onSelect={(e) => e.preventDefault()}>
                      <button
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold outline-none transition-colors",
                          active
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground focus:text-foreground",
                        )}
                      >
                        {t.label}
                        {typeof n === "number" && n > 0 && (
                          <span
                            className={cn(
                              "rounded-full px-1 text-[9px] tabular-nums",
                              t.id === "review"
                                ? "bg-amber-500 text-black"
                                : "bg-muted-foreground/20 text-muted-foreground",
                            )}
                          >
                            {n}
                          </span>
                        )}
                        {warn && (
                          <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                        )}
                      </button>
                    </DropdownMenu.Item>
                  );
                })}
              </div>

              {loading && !snapshot && (
                <p className="px-1 py-4 text-center text-xs italic text-muted-foreground">Loading…</p>
              )}

              {/* Failure — worded as "can't tell", never as "no jobs". */}
              {!loading && failed && (
                <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                  <p className="text-[11px] font-medium text-foreground">
                    The job pipeline is unreachable.
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {snapshot
                      ? "Couldn't refresh — showing the last successful fetch."
                      : "Couldn't read Supabase. This is not an empty pipeline."}
                  </p>
                </div>
              )}

              {snapshot && tab === "review" && (
                snapshot.review.length === 0 ? (
                  <EmptyState
                    title="Nothing needs review."
                    detail="A draft lands here when a match scores at or above its profile's approval threshold. Harvest and scoring run in n8n on the Mac — nothing new arrives while it sleeps."
                  />
                ) : (
                  <>
                    <ul className="flex flex-col gap-1.5">
                      {snapshot.review.map((item) => (
                        <ReviewCard
                          key={item.id}
                          item={item}
                          decision={decisions[item.id]}
                          busy={!!busyIds[item.id]}
                          error={errors[item.id] ?? null}
                          onApprove={() => void decide(item.id, "approve")}
                          onReject={() => void decide(item.id, "reject")}
                        />
                      ))}
                    </ul>
                    <WindowNotice
                      truncated={snapshot.truncated.review}
                      cap={REVIEW_LIMIT}
                      noun="drafts"
                    />
                  </>
                )
              )}

              {snapshot && tab === "matches" && (
                snapshot.matches.length === 0 ? (
                  <EmptyState
                    title="No matches yet."
                    detail="Postings that clear a profile's keyword gate appear here, scored or awaiting the model. An empty list means nothing has cleared the gate — not that nothing was harvested."
                  />
                ) : (
                  <>
                    <ul className="flex flex-col">
                      {snapshot.matches.map((m) => (
                        <MatchRow key={m.id} item={m} />
                      ))}
                    </ul>
                    <WindowNotice
                      truncated={snapshot.truncated.matches}
                      cap={MATCH_LIMIT}
                      noun="matches"
                    />
                  </>
                )
              )}

              {snapshot && tab === "sent" && (
                snapshot.sent.length === 0 ? (
                  <EmptyState
                    title="Nothing decided yet."
                    detail="Approved, queued, sent, failed and rejected applications all live here — it is a decision log, not an outbox."
                  />
                ) : (
                  <>
                    <ul className="flex flex-col">
                      {snapshot.sent.map((item) => (
                        <SentRow key={item.id} item={item} />
                      ))}
                    </ul>
                    <WindowNotice truncated={snapshot.truncated.sent} cap={SENT_LIMIT} noun="applications" />
                  </>
                )
              )}

              {snapshot && tab === "modules" && (
                snapshot.modules.length === 0 ? (
                  <EmptyState
                    title="No modules yet."
                    detail="An application is assembled from paragraphs you write once and reuse. With none, every draft is gaps — add them in Supabase or seed them from n8n/job-applier/modules.seed.sql."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {moduleWarnings > 0 && (
                      <div className="flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-1">
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          {moduleWarnings} module{moduleWarnings === 1 ? "" : "s"} still hold a
                          placeholder. Every draft that wants one comes out with a gap.
                        </p>
                      </div>
                    )}
                    {modulesBySlot.map(([slot, list]) => (
                      <div key={slot} className="flex flex-col gap-1">
                        <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {plainLine(slot, 24)}
                          <span className="ml-1 tabular-nums text-muted-foreground/50">
                            {list.length}
                          </span>
                        </p>
                        <ul className="flex flex-col gap-1">
                          {list.map((m) => (
                            <ModuleRow
                              key={m.id}
                              module={m}
                              onToggle={async (enabled) => {
                                await api.setModuleEnabled(m.id, enabled);
                                lastFetchRef.current = 0;
                                fetchSnapshot(true);
                              }}
                              onSave={async (content) => {
                                await api.setModuleContent(m.id, content);
                                lastFetchRef.current = 0;
                                fetchSnapshot(true);
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/*
                Provenance footer. Not a freshness claim: unlike mail there is no
                `job_sync` queue row to read, so the honest thing to say is where
                the work happens and what that implies, rather than to invent a
                "last synced" from the newest row — which would report the
                harvest as fresh on a morning when the Mac was asleep all night.
              */}
              <p className="border-t border-border px-1 pt-1.5 text-[9px] leading-snug text-muted-foreground/50">
                Harvested and scored by n8n on the Mac. Approving queues the send; the
                server re-checks deadlines, gaps and the daily cap before anything leaves.
              </p>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
