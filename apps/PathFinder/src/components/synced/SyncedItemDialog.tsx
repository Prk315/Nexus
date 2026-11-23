import { useEffect, useState } from "react";
import { Check, Repeat2 } from "lucide-react";
import { SYNCED_KIND_LABEL, toMinutes, type SyncedItem } from "@nexus/core/protocol";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { SYNCED_META } from "./meta";
import type { SyncedState } from "./useSyncedItems";

function spanMinutes(item: SyncedItem): number {
  if (!item.start_time || !item.end_time) return 60;
  return Math.max(5, toMinutes(item.end_time) - toMinutes(item.start_time));
}

/**
 * One Protocol occurrence, edited from PathFinder. Every control writes the
 * Protocol row directly — there is nothing to "save back" later.
 */
export function SyncedItemDialog({ item, synced, onClose }: {
  item: SyncedItem | null;
  synced: SyncedState;
  onClose: () => void;
}) {
  // The dialog shows the LIVE item: after a tick the hook reloads and hands
  // back a new object with the same key, and the dialog must follow it.
  const live = item ? synced.items.find((i) => i.key === item.key) ?? item : null;

  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [name, setName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!item) return;
    setDate(item.date);
    setStart(item.start_time ?? "");
    setMinutes(spanMinutes(item));
    setName(item.title);
    setConfirmRemove(false);
    synced.clearActionError();
    // Re-seed only when a different item opens, not on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key]);

  if (!live) return null;
  const meta = SYNCED_META[live.kind];
  const Icon = meta.icon;
  const locked = live.recordedBy != null;
  const timeChanged = start !== (live.start_time ?? "") || date !== live.date || minutes !== spanMinutes(live);
  const removeLabel = live.recurring ? "Unschedule" : live.kind === "meal" ? "Remove meal" : "Delete";

  const saveTime = async () => {
    if (!start) return;
    const ok = await synced.act((api) => api.move(live, { date, start_time: start, duration_min: minutes }));
    // A move to another day changes the key; close rather than show a stale copy.
    if (ok && date !== live.date) onClose();
  };

  const rename = async () => {
    if (name.trim() && name.trim() !== live.title) await synced.act((api) => api.renameSession(live, name));
  };

  const remove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    if (await synced.act((api) => api.remove(live))) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title={
          <span className={cn("flex items-center gap-2", meta.text)}>
            <Icon className="h-4 w-4" />
            {live.title}
            {live.recurring && <Repeat2 className="h-3.5 w-3.5 opacity-60" />}
          </span>
        }
        description={`${SYNCED_KIND_LABEL[live.kind]} from Protocol · ${live.date}${live.recordedBy ? ` · recorded by ${live.recordedBy}` : ""}`}
      >
        <div className="space-y-4">
          {/* Done */}
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant={live.done ? "outline" : "default"}
              onClick={() => synced.toggleItem(live)}
              disabled={locked && live.done}
              title={locked && live.done ? "A recorded session stays done" : undefined}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              {live.done ? "Mark not done" : live.parts.length > 0 ? "Mark all done" : "Mark done"}
            </Button>
            {live.parts.length > 0 && (
              <ul className="rounded-md border border-border divide-y divide-border">
                {live.parts.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent/50">
                      <input
                        type="checkbox"
                        checked={p.done}
                        onChange={() => synced.togglePart(live, p.id)}
                        className="h-3.5 w-3.5 accent-current"
                      />
                      <span className={cn("flex-1", p.done && "line-through text-muted-foreground")}>{p.label}</span>
                      {p.detail && <span className="text-xs text-muted-foreground tabular-nums">{p.detail}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Name — trainings only carry their own */}
          {live.kind === "workout" && !locked && (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename}
                onKeyDown={(e) => { if (e.key === "Enter") void rename(); }} aria-label="Session name" />
            </div>
          )}

          {/* When */}
          {!locked && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>Day</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={live.recurring} />
                </label>
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>Start</span>
                  <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>Minutes</span>
                  <Input type="number" min={5} step={5} value={minutes}
                    onChange={(e) => setMinutes(Math.max(5, Number(e.target.value) || 5))}
                    disabled={live.kind === "meal"} />
                </label>
              </div>
              {live.recurring && (
                <p className="text-xs text-muted-foreground">
                  Repeats — a new time applies to every day it's due. Change its days in Protocol, or unschedule it here.
                </p>
              )}
              {live.timeIsDefault && (
                <p className="text-xs text-muted-foreground">This is the {live.ref} default time. Setting one saves it to the meal.</p>
              )}
              {timeChanged && start && (
                <Button size="sm" variant="outline" onClick={saveTime}>Save time</Button>
              )}
            </div>
          )}

          {synced.actionError && (
            <p className="text-xs text-destructive" role="alert">{synced.actionError}</p>
          )}

          {!locked && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" variant={confirmRemove ? "destructive" : "ghost"} onClick={remove}
                className={cn(!confirmRemove && "text-destructive")}>
                {confirmRemove ? `${removeLabel}?` : removeLabel}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
