import { useRef, useState } from "react";
import { Mail, ChevronDown, ChevronRight } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "../utils";
import type { MailMessage } from "../mail/types";
import { MAIL_FETCH_LIMIT, type MailLoader, type MailSnapshot } from "../mail/loader";
import {
  BUCKET_HEX,
  BUCKET_LABEL,
  groupByBucket,
  plainLine,
  plainText,
  priorityBucket,
  triageInbox,
  type MailTriage,
} from "../mail/priority";

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
  /** Open mail plus the freshness signal. See `createMailLoader`. */
  loadMail: MailLoader;
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

// ── Row ──────────────────────────────────────────────────────────────────

function MailRow({ message }: { message: MailMessage }) {
  const [expanded, setExpanded] = useState(false);
  const bucket = priorityBucket(message.priority);
  // All four of these are LLM-authored from arbitrary email content. They are
  // rendered as React children (escaped) and passed through plainText/plainLine
  // first; nothing here ever goes near dangerouslySetInnerHTML.
  const subject = plainLine(message.subject, 120) || "(no subject)";
  const snippet = plainLine(message.snippet, 160);
  const category = plainLine(message.category, 24);
  const reply = plainText(message.suggested_reply, 1200);

  return (
    <li className="rounded-md px-1.5 py-1.5 hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          title={`${BUCKET_LABEL[bucket]} priority`}
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
          <div className="mt-1 flex items-center gap-1.5">
            {category && (
              <span className="rounded-sm bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                {category}
              </span>
            )}
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

function TriageList({ triage }: { triage: MailTriage }) {
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
              <MailRow key={m.id} message={m} />
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

export function MailPanel({ loadMail }: MailPanelProps) {
  const [snapshot, setSnapshot] = useState<MailSnapshot | null>(null);
  const [triage, setTriage] = useState<MailTriage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef(0);

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
        setTriage(triageInbox(result.messages));
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
          <div className="flex items-baseline justify-between px-1">
            <p className="text-[11px] font-semibold text-foreground">Mail</p>
            {triage && pendingCount > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {pendingCount} to triage
              </span>
            )}
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

          {!loading && triage && pendingCount > 0 && <TriageList triage={triage} />}

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
    </DropdownMenu.Root>
  );
}
