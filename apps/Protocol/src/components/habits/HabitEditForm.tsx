import { useState } from "react";
import { Check } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addHabitStack } from "../../store/slices/habitsSlice";
import { CARD_STYLE, LABEL_STYLE, FIELD_GROUP, INPUT_SM, SUBMIT_BTN_STYLE } from "../../lib/uiHelpers";
import type { Habit, UpdateHabit } from "../../store/types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NEW_STACK = "__new__";
const NO_STACK = "";

export default function HabitEditForm({
  habit, onSave, onCancel,
}: {
  habit: Habit;
  onSave: (update: UpdateHabit) => Promise<void>;
  onCancel: () => void;
}) {
  const dispatch = useAppDispatch();
  const stacks = useAppSelector((s) => s.habits.stacks);

  const [description, setDescription] = useState(habit.description ?? "");
  const [scheduledTime, setScheduledTime] = useState(habit.scheduled_time?.slice(0, 5) ?? "");
  const [durationMin, setDurationMin] = useState(habit.duration_min != null ? String(habit.duration_min) : "");
  const [repeatDays, setRepeatDays] = useState<number[]>(habit.repeat_days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [stackChoice, setStackChoice] = useState(habit.stack_id ?? NO_STACK);
  const [newStackName, setNewStackName] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setRepeatDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let stackId: string | null = stackChoice || null;
      if (stackChoice === NEW_STACK) {
        if (!newStackName.trim()) {
          setSaving(false);
          return;
        }
        const stack = await dispatch(addHabitStack({ name: newStackName.trim() })).unwrap();
        stackId = stack.id;
      }
      await onSave({
        id: habit.id,
        description: description.trim() || null,
        scheduled_time: scheduledTime || null,
        duration_min: durationMin ? parseInt(durationMin) : null,
        repeat_days: repeatDays.length === 7 ? null : repeatDays,
        stack_id: stackId,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ ...CARD_STYLE, padding: 18, display: "flex", flexDirection: "column", gap: 14, background: "var(--bg)" }}
    >
      <div style={FIELD_GROUP}>
        <label style={LABEL_STYLE}>Description</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this habit about?"
          style={{ ...INPUT_SM, resize: "vertical" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Time of day</label>
          <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} style={INPUT_SM} />
        </div>
        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Duration (min)</label>
          <input
            type="number" min={0} max={600} placeholder="—"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            style={INPUT_SM}
          />
        </div>
      </div>

      <div style={FIELD_GROUP}>
        <label style={LABEL_STYLE}>Repeats on</label>
        <div style={{ display: "flex", gap: 6 }}>
          {DAY_LABELS.map((label, i) => {
            const active = repeatDays.includes(i);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(i)}
                title={label}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-fg)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {label[0]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={FIELD_GROUP}>
        <label style={LABEL_STYLE}>Stack</label>
        <select value={stackChoice} onChange={(e) => setStackChoice(e.target.value)} style={INPUT_SM}>
          <option value={NO_STACK}>No stack</option>
          {stacks.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value={NEW_STACK}>+ New stack…</option>
        </select>
        {stackChoice === NEW_STACK && (
          <input
            type="text"
            autoFocus
            value={newStackName}
            onChange={(e) => setNewStackName(e.target.value)}
            placeholder="e.g. Morning Routine"
            style={{ ...INPUT_SM, marginTop: 6 }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving} style={SUBMIT_BTN_STYLE}>
          <Check size={14} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 16px", fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
