import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Lock,
  Minus,
  PartyPopper,
  Pencil,
  Plus,
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
  PROFILE_LIMIT,
  REVIEW_LIMIT,
  SENT_LIMIT,
  type JobProfilePatch,
  type JobsApi,
  type JobsAttention,
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
import {
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  addChip,
  ago,
  attemptLine,
  chipsEqual,
  clampThreshold,
  isResponseStatus,
  jobsBadgeCount,
  removeChip,
} from "../jobs/format";
import type {
  JobAppModule,
  JobApplicationItem,
  JobMatchItem,
  JobProfileFull,
  JobSubmissionAttempt,
} from "../jobs/types";

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

type Tab = "review" | "matches" | "sent" | "profiles" | "modules";

const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "matches", label: "Matches" },
  { id: "sent", label: "Sent" },
  { id: "profiles", label: "Profiles" },
  { id: "modules", label: "Modules" },
];

/**
 * How long a decided Approve/Reject button stays visibly spent.
 *
 * The write is already idempotent — both are guarded on `status =
 * needs_approval`, so a double-click's second call matches zero rows and
 * resolves `null` — so this buys nothing at the database. It buys the *UI* not
 * flickering between busy and idle fast enough to look like the click missed,
 * which is exactly what makes someone click again.
 */
const PRESS_HOLD_MS = 2000;

// ── Small local helpers ──────────────────────────────────────────────────

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
  /**
   * Which button was pressed, held for `PRESS_HOLD_MS`.
   *
   * `busy` alone is not enough: the write is one fast `.update()`, so the
   * spinner can come and go inside a double-click's own interval and the card
   * looks untouched right up until the refetch lands 400 ms later. Holding the
   * pressed state past that window is what makes the click feel like it landed.
   */
  const [pressed, setPressed] = useState<"approve" | "reject" | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The card unmounts the moment a decision receipt replaces it, which is well
  // inside the hold — without this the timer fires into a dead component.
  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  function press(kind: "approve" | "reject", run: () => void) {
    if (pressed || busy) return;
    setPressed(kind);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(null), PRESS_HOLD_MS);
    run();
  }

  const held = pressed !== null || busy;
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
          onClick={() => press("approve", onApprove)}
          disabled={held}
          title="Approve — the sender picks it up on its next pass"
          className="h-7 flex-1 justify-center bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-500 focus:bg-emerald-500"
        >
          {busy || pressed === "approve" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {pressed === "approve" ? "Approving…" : "Approve"}
        </MenuButton>
        <MenuButton
          onClick={() => press("reject", onReject)}
          disabled={held}
          title="Reject — the draft is kept, cancelled"
          className="h-7 justify-center border border-border px-3 text-[11px] font-medium text-muted-foreground hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          {pressed === "reject" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          {pressed === "reject" ? "Rejecting…" : "Reject"}
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

type StatusTone = "reply" | "good" | "bad" | "neutral" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  // Filled, not tinted. Every other chip here is a 15%-opacity wash on the
  // popover background; this one is the only solid block in the tab, because a
  // reply is the only row in it that is asking for something back.
  reply: "bg-fuchsia-600 text-white border-fuchsia-600",
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
    case "response":
      // ⚠️ Recency here is `updated_at`, deliberately, and NOT `responded_at`.
      // The column that would be more precise is arriving in a migration this
      // code does not own, and PostgREST rejects the **whole** query on an
      // unknown column — so naming it in `JOB_APPLICATION_COLUMNS` would not
      // degrade the Sent tab, it would empty it, on every branch pointed at a
      // database where the migration has not been applied yet. `updated_at` has
      // existed since the first job migration and moves when the status does,
      // which is close enough for "3h ago".
      return { tone: "reply", label: "Replied", detail: ago(item.updated_at) };
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

/** One attempt, as one line. All of the deciding happens in `attemptLine`. */
function AttemptLineRow({ attempt }: { attempt: JobSubmissionAttempt }) {
  const line = attemptLine(attempt);
  return (
    <li className="flex items-start gap-1.5 text-[9px] leading-snug">
      <span
        title={line.label}
        className={cn(
          "mt-px w-3 shrink-0 text-center font-bold tabular-nums",
          line.outcome === "ok" && "text-emerald-600 dark:text-emerald-400",
          line.outcome === "failed" && "text-rose-600 dark:text-rose-400",
          // Violet, matching the pending score band — same meaning, same colour
          // family: "no verdict", never "a bad verdict".
          line.outcome === "pending" && "text-violet-600 dark:text-violet-400",
        )}
      >
        {line.mark}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground/70">{line.when || "time unknown"}</span>
        {line.outcome === "pending" && (
          <span className="ml-1 text-violet-600 dark:text-violet-400">{line.label}</span>
        )}
        {line.proofId && (
          <span
            className="ml-1 font-mono text-muted-foreground/50"
            title="Gmail message id — the proof of what left the machine"
          >
            {line.proofId}
          </span>
        )}
        {line.error && (
          <p className="truncate text-rose-600 dark:text-rose-400" title={plainLine(line.error, 400)}>
            {plainLine(line.error, 120)}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * One decided application.
 *
 * Two things beyond a chip and a title: the attempt log, fetched **only when
 * expanded**, and the reply treatment. The lazy fetch is the point — a Sent tab
 * that queried `job_submission_attempts` per row on open would fire thirty
 * queries to render nothing anybody asked to see.
 */
function SentRow({
  item,
  loadAttempts,
}: {
  item: JobApplicationItem;
  loadAttempts: (id: string) => Promise<JobSubmissionAttempt[]>;
}) {
  const [open, setOpen] = useState(false);
  const [attempts, setAttempts] = useState<JobSubmissionAttempt[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = statusChip(item);
  const replied = isResponseStatus(item.status);
  const title = plainLine(item.posting?.title, 80) || "(untitled posting)";
  const company = plainLine(item.posting?.company, 44);
  const profile = plainLine(item.profile?.name, 24);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Fetched once per row per panel session. Re-opening a row shows what was
    // fetched rather than re-querying: the log is append-only and a retry lands
    // minutes apart at best, so a refetch on every chevron buys nothing.
    if (!next || attempts !== null || loading) return;
    setLoading(true);
    setError(null);
    loadAttempts(item.id)
      .then(setAttempts)
      // Never `setAttempts([])` on failure. An empty log reads as "nothing was
      // ever sent to this company", which is the single most misleading thing
      // this panel could say — so a failed read says it failed.
      .catch((e) => setError(e instanceof Error ? e.message : "couldn't read the attempt log"))
      .finally(() => setLoading(false));
  }

  return (
    <li
      className={cn(
        "rounded-md px-1.5 py-1.5 transition-colors",
        replied
          ? "border border-fuchsia-500/50 bg-fuchsia-500/10 hover:bg-fuchsia-500/15"
          : "hover:bg-accent/50",
      )}
    >
      {replied && (
        <div className="mb-1 flex items-center gap-1.5">
          <PartyPopper className="h-3.5 w-3.5 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" />
          <p className="text-[11px] font-bold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300">
            They replied!
          </p>
        </div>
      )}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-px inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
            TONE_CLASS[chip.tone],
          )}
        >
          {chip.label}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[11px] text-foreground",
              replied ? "font-bold" : "font-medium",
            )}
          >
            {title}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {[company, profile].filter(Boolean).join(" · ") || "—"}
          </p>
          {chip.detail && (
            <p
              className={cn(
                "mt-0.5 text-[9px]",
                chip.tone === "bad"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground/60",
              )}
            >
              {chip.detail}
            </p>
          )}
          {replied && (
            <p className="mt-0.5 text-[9px] leading-snug text-fuchsia-700/90 dark:text-fuchsia-300/80">
              A human at this company answered. Check your inbox — nothing in this
              pipeline replies for you.
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Disclosure
              open={open}
              onToggle={toggle}
              label={open ? "Hide attempts" : "Attempts"}
            />
            <PostingLink url={item.posting?.url} />
          </div>
          {open && (
            <div className="mt-1 rounded-md border border-border bg-muted/30 px-1.5 py-1">
              {loading && (
                <p className="text-[9px] italic text-muted-foreground/60">Reading the log…</p>
              )}
              {error && (
                <p className="text-[9px] italic text-destructive">
                  {plainLine(error, 120)} — this is not "nothing was sent".
                </p>
              )}
              {!loading && !error && attempts !== null && attempts.length === 0 && (
                <p className="text-[9px] italic text-muted-foreground/60">
                  No send has been attempted yet.
                </p>
              )}
              {attempts !== null && attempts.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {attempts.map((a) => (
                    <AttemptLineRow key={a.id} attempt={a} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Profiles ─────────────────────────────────────────────────────────────

/**
 * A `text[]` as add/remove chips.
 *
 * Writes the **whole array** every time, because that is what a Postgres array
 * column is — there is no "append one element" through PostgREST, and
 * pretending otherwise is how two chips added in quick succession end with the
 * second overwriting the first. The list handed in is always the stored one (or
 * the optimistic overlay of it), never a local accumulation.
 */
function ChipEditor({
  label,
  hint,
  values,
  tone,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  values: string[];
  tone: "keyword" | "exclude";
  disabled: boolean;
  onCommit: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const next = addChip(values, draft);
    setDraft("");
    // `addChip` returns the same contents for an empty or duplicate entry, so
    // this skips a round trip that would only bump `updated_at`.
    if (chipsEqual(next, values)) return;
    onCommit(next);
  }

  return (
    <div className="mt-1">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
        <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/50">
          {hint}
        </span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {values.length === 0 && (
          <span className="text-[9px] italic text-muted-foreground/50">
            {tone === "keyword"
              ? "none — this profile matches nothing"
              : "none — nothing is excluded"}
          </span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px text-[9px] font-medium",
              tone === "keyword"
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
            )}
          >
            {plainLine(v, 26)}
            <MenuButton
              onClick={() => onCommit(removeChip(values, v))}
              disabled={disabled}
              title={`Remove ‘${plainLine(v, 26)}’`}
              className="ml-0.5 opacity-60 hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </MenuButton>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder="add…"
          // ⚠️ Same Radix typeahead trap as the module textarea: `DropdownMenu.
          // Content`'s onKeyDown fires for any single-character keydown that
          // bubbles to it and would jump focus out of this field on the first
          // letter. Enter is handled here rather than by a form, because there
          // is no form — the menu is the container.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          className="h-5 w-[76px] rounded-sm border border-dashed border-border bg-transparent px-1 text-[9px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-ring disabled:opacity-50"
        />
      </div>
    </div>
  );
}

/**
 * The approval threshold, as a stepper.
 *
 * Committed on blur and on Enter, never on keystroke: typing "8" on the way to
 * "85" would otherwise store 8 for a moment, and with the harvester running on
 * its own schedule that moment is enough to queue a pile of drafts nobody
 * wanted. `clampThreshold` returning `null` for an empty field is what makes
 * backspacing safe — it restores the stored value rather than writing 0.
 */
function ThresholdStepper({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const serverRef = useRef(value);

  // Adopt a changed stored value only when the field is untouched — same rule,
  // and the same reason, as `ModuleRow`'s draft adoption.
  useEffect(() => {
    if (value === serverRef.current) return;
    const untouched = draft === String(serverRef.current);
    serverRef.current = value;
    if (untouched) setDraft(String(value));
  }, [value, draft]);

  function commit(raw: string) {
    const next = clampThreshold(raw);
    if (next === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(next));
    if (next === value) return;
    onCommit(next);
  }

  function step(delta: number) {
    const next = clampThreshold(value + delta);
    if (next === null || next === value) return;
    setDraft(String(next));
    onCommit(next);
  }

  return (
    <div className="flex items-center gap-0.5">
      <MenuButton
        onClick={() => step(-5)}
        disabled={disabled || value <= THRESHOLD_MIN}
        title="Lower the bar — more drafts ask for approval"
        className="h-5 w-5 justify-center border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Minus className="h-2.5 w-2.5" />
      </MenuButton>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        inputMode="numeric"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => commit(draft)}
        className="h-5 w-9 rounded-sm border border-border bg-background text-center text-[10px] font-semibold tabular-nums text-foreground outline-none focus:border-ring disabled:opacity-50"
      />
      <MenuButton
        onClick={() => step(5)}
        disabled={disabled || value >= THRESHOLD_MAX}
        title="Raise the bar — only stronger matches ask"
        className="h-5 w-5 justify-center border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-2.5 w-2.5" />
      </MenuButton>
    </div>
  );
}

function ProfileRow({
  profile: p,
  busy,
  error,
  onPatch,
}: {
  profile: JobProfileFull;
  busy: boolean;
  error: string | null;
  onPatch: (patch: JobProfilePatch) => void;
}) {
  const keywords = (p.keywords ?? []).filter(Boolean);
  const excludes = (p.exclude_terms ?? []).filter(Boolean);
  const locations = (p.locations ?? []).filter(Boolean);
  // The one state this panel can produce that silently harvests nothing at all.
  const inert = p.enabled && keywords.length === 0;

  return (
    <li
      className={cn(
        "rounded-md border px-2 py-1.5 transition-colors",
        inert
          ? "border-amber-500/60 bg-amber-500/10"
          : p.enabled
            ? "border-border bg-card/30"
            : "border-dashed border-border bg-transparent",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] font-semibold",
            p.enabled ? "text-foreground" : "text-muted-foreground line-through",
          )}
        >
          {plainLine(p.name, 46)}
        </span>
        {busy && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-muted-foreground/60" />}
        <MenuButton
          onClick={() => onPatch({ enabled: !p.enabled })}
          disabled={busy}
          title={p.enabled ? "Disable — the harvester stops running it" : "Enable"}
          className={cn(
            "h-5 shrink-0 px-1.5 text-[9px] font-medium",
            p.enabled
              ? "bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-300"
              : "bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          <Power className="h-2.5 w-2.5" />
          {p.enabled ? "on" : "off"}
        </MenuButton>
      </div>

      {inert && (
        <p className="mt-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
          Enabled with no keywords — the gate matches nothing, so this profile
          harvests silently and forever.
        </p>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Ask me at
        </span>
        <ThresholdStepper
          value={p.approval_threshold}
          disabled={busy}
          onCommit={(next) => onPatch({ approval_threshold: next })}
        />
        <span className="text-[9px] text-muted-foreground/50">
          and above — below it the draft is never raised.
        </span>
      </div>

      <ChipEditor
        label="Keywords"
        hint="any one of these must appear"
        values={keywords}
        tone="keyword"
        disabled={busy}
        onCommit={(next) => onPatch({ keywords: next })}
      />
      <ChipEditor
        label="Exclude"
        hint="any one of these drops the posting"
        values={excludes}
        tone="exclude"
        disabled={busy}
        onCommit={(next) => onPatch({ exclude_terms: next })}
      />

      {/*
        Read-only, and labelled as such rather than merely absent.
        An empty `locations` means "anywhere" in `filterLocation`, so removing
        the last entry silently WIDENS the search — the opposite of what
        deleting a chip looks like it does. That is a decision to make on
        purpose, not one to discover afterwards.
      */}
      <div className="mt-1">
        <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          <Lock className="h-2.5 w-2.5" />
          Locations
          <span className="font-normal normal-case tracking-normal text-muted-foreground/50">
            edit in Supabase — an empty list means anywhere
          </span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {locations.length === 0 ? (
            <span className="text-[9px] italic text-muted-foreground/50">
              anywhere (no location filter)
            </span>
          ) : (
            locations.map((l) => (
              <span
                key={l}
                className="rounded-sm bg-muted px-1.5 py-px text-[9px] text-muted-foreground"
              >
                {plainLine(l, 26)}
              </span>
            ))
          )}
        </div>
      </div>

      {error && <p className="mt-1 text-[9px] italic text-destructive">{plainLine(error, 140)}</p>}
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
  const [attention, setAttention] = useState<JobsAttention | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busyIds, setBusyIds] = useState<Record<string, true>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /**
   * The optimistic overlay for profile edits, by profile id.
   *
   * Applied over the snapshot's rows on render. A commit writes the guess here
   * immediately, replaces it with the **server's** row on success, and deletes
   * it on failure — which is the rollback. Deleting rather than restoring an
   * old copy is what makes the rollback correct even if the snapshot refetched
   * underneath: the truth is whatever the snapshot holds, and the overlay only
   * ever exists to sit on top of it briefly.
   */
  const [profileEdits, setProfileEdits] = useState<Record<string, JobProfileFull>>({});
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
          // receipts and profile overlays have served their purpose and would
          // otherwise linger over rows the server has already moved on.
          setDecisions({});
          setProfileEdits({});
          // Derived from the fetched windows — but a **truncated** window is a
          // floor, not a count, so in that case the polled number (a real
          // `head: true` count with no cap) is kept instead of being replaced
          // by a smaller one. A badge that shrinks when you open the panel is
          // the wrong kind of surprise.
          setAttention((prev) => ({
            needsApproval: result.truncated.review
              ? (prev?.needsApproval ?? result.review.length)
              : result.review.length,
            responses: result.truncated.sent
              ? (prev?.responses ?? 0)
              : result.sent.filter((a) => isResponseStatus(a.status)).length,
          }));
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
      setAttention(null);
      return;
    }
    let active = true;
    const tick = () => {
      api
        .countAttention()
        .then((n) => {
          if (active) setAttention(n);
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
      setAttention((a) =>
        a ? { ...a, needsApproval: a.needsApproval > 0 ? a.needsApproval - 1 : 0 } : a,
      );
      // Refetch so the row lands in Sent with whatever the server actually did.
      lastFetchRef.current = 0;
      setTimeout(() => fetchSnapshot(true), 400);
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: e instanceof Error ? e.message : "couldn't save" }));
    } finally {
      setBusyIds(({ [id]: _drop, ...rest }) => rest);
    }
  }

  /**
   * A profile edit: optimistic, then reconciled, then rolled back on failure.
   *
   * Same shape as `decide` above and as `mail/api`'s row actions — apply the
   * guess, let the server's answer overwrite it, and on an error remove the
   * guess so the row snaps back to what is actually stored. The `busyIds` /
   * `errors` maps are shared with the review cards; ids are uuids from
   * different tables and cannot collide.
   */
  async function patchProfile(current: JobProfileFull, patch: JobProfilePatch) {
    if (!api || busyIds[current.id]) return;
    const optimistic: JobProfileFull = { ...current, ...patch };
    setProfileEdits((e) => ({ ...e, [current.id]: optimistic }));
    setBusyIds((b) => ({ ...b, [current.id]: true }));
    setErrors(({ [current.id]: _drop, ...rest }) => rest);
    try {
      const row = await api.updateProfile(current.id, patch);
      // Adopt the stored row, not the guess. A threshold the API clamped, or a
      // trigger-touched field, is otherwise invisible until the next refetch.
      setProfileEdits((e) => ({ ...e, [current.id]: row }));
    } catch (e) {
      // The rollback.
      setProfileEdits(({ [current.id]: _drop, ...rest }) => rest);
      setErrors((x) => ({
        ...x,
        [current.id]: e instanceof Error ? e.message : "couldn't save",
      }));
    } finally {
      setBusyIds(({ [current.id]: _drop, ...rest }) => rest);
    }
  }

  /** The snapshot's profiles with any in-flight or just-saved edit laid over them. */
  const profiles = useMemo(
    () => (snapshot?.profiles ?? []).map((p) => profileEdits[p.id] ?? p),
    [snapshot?.profiles, profileEdits],
  );

  /**
   * Replies first, then everything else in the order the server sent.
   *
   * A stable partition rather than a re-sort: within each group the loader's
   * `updated_at desc` still holds, so nothing reshuffles — the only claim being
   * made is that a reply outranks a rejection from the same afternoon.
   */
  const sentOrdered = useMemo(() => {
    const rows = snapshot?.sent ?? [];
    const replies = rows.filter((r) => isResponseStatus(r.status));
    if (replies.length === 0) return rows;
    return [...replies, ...rows.filter((r) => !isResponseStatus(r.status))];
  }, [snapshot?.sent]);

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

  /** Enabled, but with an empty keyword list — a search that quietly finds nothing. */
  const profileWarnings = useMemo(
    () => profiles.filter((p) => p.enabled && (p.keywords ?? []).filter(Boolean).length === 0).length,
    [profiles],
  );

  const counts: Record<Tab, number | null> = {
    review: snapshot ? snapshot.review.length : (attention?.needsApproval ?? null),
    matches: snapshot ? snapshot.matches.length : null,
    sent: snapshot ? snapshot.sent.length : null,
    profiles: snapshot ? snapshot.profiles.length : null,
    modules: snapshot ? snapshot.modules.length : null,
  };

  /**
   * The badge: **decisions waiting + replies received.**
   *
   * The arithmetic lives in `jobsBadgeCount` rather than inline, because the
   * interesting part is what it does with unknowns — a failed count must not
   * become a zero, and a known half must not be suppressed by an unknown one.
   */
  const replies = attention?.responses ?? 0;
  const pending = jobsBadgeCount(
    attention?.needsApproval ?? snapshot?.review.length ?? null,
    attention?.responses ?? null,
  ) ?? 0;

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          title={
            pending === 0
              ? "Jobs"
              : [
                  (attention?.needsApproval ?? 0) > 0
                    ? `${attention?.needsApproval} to review`
                    : "",
                  replies > 0 ? `${replies} repl${replies === 1 ? "y" : "ies"}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Briefcase className="h-4 w-4" />
          {pending > 0 && (
            // Amber, not mail's red: this is "a decision is waiting on you",
            // which is a different feeling from "unread". A number rather than a
            // dot, because the useful question is how big the queue is.
            //
            // Fuchsia the moment a reply is in the count, matching the Sent
            // tab's chip: the badge changing colour is the only signal that
            // reaches someone who is not going to open the panel, and "a
            // company answered you" deserves to look different from "three more
            // drafts piled up".
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none tabular-nums",
                replies > 0 ? "bg-fuchsia-600 text-white" : "bg-amber-500 text-black",
              )}
            >
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
                  const warn =
                    (t.id === "modules" && moduleWarnings > 0) ||
                    (t.id === "profiles" && profileWarnings > 0);
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
                    <ul className="flex flex-col gap-1">
                      {sentOrdered.map((item) => (
                        <SentRow key={item.id} item={item} loadAttempts={api.loadAttempts} />
                      ))}
                    </ul>
                    <WindowNotice truncated={snapshot.truncated.sent} cap={SENT_LIMIT} noun="applications" />
                  </>
                )
              )}

              {snapshot && tab === "profiles" && (
                profiles.length === 0 ? (
                  <EmptyState
                    title="No search profiles."
                    detail="A profile is the search persona the harvester runs — its keywords are the gate, and its threshold decides which drafts ask for your approval. Create one in Supabase; this panel edits them but deliberately does not add or remove them."
                  />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <ul className="flex flex-col gap-1.5">
                      {profiles.map((p) => (
                        <ProfileRow
                          key={p.id}
                          profile={p}
                          busy={!!busyIds[p.id]}
                          error={errors[p.id] ?? null}
                          onPatch={(patch) => void patchProfile(p, patch)}
                        />
                      ))}
                    </ul>
                    <WindowNotice
                      truncated={snapshot.truncated.profiles}
                      cap={PROFILE_LIMIT}
                      noun="profiles"
                    />
                    {/*
                      Stated, not merely absent. Both omissions are deliberate
                      and both are sharp: an inserted profile with no keywords
                      matches nothing and looks like a working search forever,
                      and deleting one cascades to every match and application
                      that hangs off it. Neither belongs behind a button in a
                      dropdown.
                    */}
                    <p className="px-1 text-[9px] leading-snug text-muted-foreground/50">
                      Adding and deleting profiles is Supabase-only on purpose — a new
                      profile with no keywords matches nothing silently, and deleting
                      one cascades to its matches and applications.
                    </p>
                  </div>
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
                      <div className="flex items-start gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-1">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            {moduleWarnings} module{moduleWarnings === 1 ? "" : "s"} still hold a
                            placeholder. Every draft that wants one comes out with a gap.
                          </p>
                          {/*
                            Names the three seeded stubs outright. "N modules
                            hold a placeholder" is true and useless — the seed
                            ships exactly these three deliberately empty,
                            because none of them is something this system may
                            invent on a person's behalf, and knowing *which*
                            three is the difference between a warning and an
                            instruction.
                          */}
                          <p className="mt-0.5 text-[9px] leading-snug text-amber-800/80 dark:text-amber-200/70">
                            <span className="font-mono">education_stub</span> ·{" "}
                            <span className="font-mono">cv_link</span> ·{" "}
                            <span className="font-mono">portfolio_link</span> ship empty on purpose —
                            write and enable them to unlock sending.
                          </p>
                        </div>
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
