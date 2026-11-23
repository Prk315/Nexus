import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  LEAD_OPTIONS,
  fromLocalInputValue,
  reminderPresets,
  toLocalInputValue,
  type CalReminder,
} from "../../lib/reminders";
import type { CalRemindersState } from "./useCalReminders";

const selectCls = "h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm";

/**
 * Create a timed reminder, or edit / tick / clear / delete one. `reminder` set
 * = edit; null with `createAt` set = create, prefilled to that moment.
 */
export function ReminderDialog({ reminder, createAt, state, onClose }: {
  reminder: CalReminder | null;
  /** ISO instant to prefill when creating, e.g. the slot that was clicked. */
  createAt: string | null;
  state: CalRemindersState;
  onClose: () => void;
}) {
  const open = reminder != null || createAt != null;
  // Follow the live row after a tick reloads the list.
  const live = reminder ? state.reminders.find((r) => r.task_id === reminder.task_id) ?? reminder : null;

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [lead, setLead] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(reminder?.title ?? "");
    setWhen(toLocalInputValue(reminder?.remind_at ?? createAt));
    setLead(reminder?.lead_minutes ?? null);
    setConfirmDelete(false);
    state.clearActionError();
    // Re-seed per opening, not on every reload of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reminder?.task_id, createAt]);

  if (!open) return null;

  const done = async (ok: boolean) => { setBusy(false); if (ok) onClose(); };

  const submit = async () => {
    setBusy(true);
    const attrs = { remind_at: fromLocalInputValue(when), lead_minutes: lead };
    if (live) await done(await state.save(live.task_id, attrs));
    else await done(await state.create(title, attrs));
  };

  const clearTime = async () => {
    if (!live) return;
    setBusy(true);
    // The reminder stays — it just leaves the calendar for the sidebar list.
    await done(await state.save(live.task_id, { remind_at: null, lead_minutes: live.lead_minutes }));
  };

  const remove = async () => {
    if (!live) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    await done(await state.remove(live.task_id));
  };

  const canSubmit = !busy && (live ? true : title.trim().length > 0) && fromLocalInputValue(when) != null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={<span className="flex items-center gap-2"><Bell className="h-4 w-4 text-rose-500" />{live ? live.title : "New reminder"}</span>}
        description={live ? "Reminder" : "Shows on the calendar at its time, and in the Reminders panel."}
      >
        <div className="space-y-3">
          {live && (
            <Button size="sm" variant={live.done ? "outline" : "default"} onClick={() => state.toggle(live)} disabled={busy}>
              <Check className="h-3.5 w-3.5 mr-1" />{live.done ? "Mark not done" : "Mark done"}
            </Button>
          )}

          {!live && (
            <Input autoFocus value={title} placeholder="Call the dentist" onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) void submit(); }} aria-label="Reminder" />
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground space-y-1">
              <span>When</span>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              <span>Heads-up</span>
              <select className={selectCls} value={lead ?? ""} onChange={(e) => setLead(e.target.value === "" ? null : Number(e.target.value))}>
                {LEAD_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {reminderPresets(new Date()).map((p) => (
              <button key={p.label} type="button" onClick={() => setWhen(toLocalInputValue(p.iso))}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                {p.label}
              </button>
            ))}
          </div>

          {state.actionError && <p className="text-xs text-destructive" role="alert">{state.actionError}</p>}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex gap-1">
              {live && (
                <>
                  <Button size="sm" variant="ghost" onClick={clearTime} disabled={busy}
                    title="Keep the reminder, take it off the calendar">Clear time</Button>
                  <Button size="sm" variant={confirmDelete ? "destructive" : "ghost"} onClick={remove} disabled={busy}
                    className={cn(!confirmDelete && "text-destructive")}>
                    {confirmDelete ? "Delete?" : "Delete"}
                  </Button>
                </>
              )}
            </div>
            <Button size="sm" onClick={submit} disabled={!canSubmit}>{live ? "Save" : "Add reminder"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
