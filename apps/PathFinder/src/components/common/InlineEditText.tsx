// A reusable click-to-edit text field: renders plain text (or arbitrary
// children) until activated, then swaps in an input occupying the same
// footprint. Same interaction idiom as BreakdownTree's inline title editor
// (Enter/blur commits, Escape reverts) — lifted out so wave-2 task-row work
// doesn't hand-roll a fourth copy of it.
//
// Supports BOTH activation styles a caller might want:
//   - controlled: pass `editing` + `onEditingChange` (e.g. TaskActionMenu's
//     "Rename" item flips a row into edit mode from outside).
//   - uncontrolled: omit both — a double-click on the text activates it.
// The two are not mutually exclusive in the type, but mixing them (passing
// `editing` without `onEditingChange`, or vice versa) leaves the component
// unable to ever leave/enter edit mode from its own double-click handler,
// so treat them as a pair.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface InlineEditTextProps {
  /** The live value. Also seeds the input's draft on activation. */
  value: string;
  /** Fired on commit with the trimmed value. Never fired for an empty or unchanged result. */
  onCommit: (value: string) => void;
  /** Controlled editing state. Omit for uncontrolled (double-click to activate). */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** What to render in the non-editing state. Defaults to `value` as plain text. */
  children?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

export function InlineEditText({
  value,
  onCommit,
  editing,
  onEditingChange,
  children,
  placeholder,
  disabled = false,
  className,
  inputClassName,
}: InlineEditTextProps) {
  const isControlled = editing !== undefined;
  const [internalEditing, setInternalEditing] = useState(false);
  const isEditing = isControlled ? editing : internalEditing;

  const [draft, setDraft] = useState(value);
  const wasEditing = useRef(isEditing);

  // Reset the draft to the live value every time editing turns ON — so a
  // stale keystroke from a previous activation (e.g. a cancelled edit whose
  // draft never got reset) can't leak into a new one.
  useEffect(() => {
    if (isEditing && !wasEditing.current) setDraft(value);
    wasEditing.current = isEditing;
  }, [isEditing, value]);

  const setEditing = (next: boolean) => {
    if (!isControlled) setInternalEditing(next);
    onEditingChange?.(next);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === value) return; // ignores empty/unchanged, per spec
    onCommit(trimmed);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!isEditing) {
    return (
      <span
        className={cn(!disabled && "cursor-text", className)}
        onDoubleClick={() => { if (!disabled) setEditing(true); }}
      >
        {children ?? value}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "min-w-0 flex-1 bg-transparent border-b border-primary/40 text-sm outline-none py-0.5",
        inputClassName,
      )}
    />
  );
}
