import { X } from "lucide-react";
import { cn } from "./utils";

// Tag helpers shared across pages (extracted from the former Plans page).

export function parseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function serializeTags(tags: string[]): string | null {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return clean.length > 0 ? clean.join(",") : null;
}

// Tag colors cycle through a palette
const TAG_COLORS = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-400/30",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-400/30",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-400/30",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-400/30",
  "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-400/30",
];

const FIXED_TAG_COLOR: Record<string, string> = {
  course: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-400/40",
};

export function tagColor(tag: string, index = 0): string {
  return FIXED_TAG_COLOR[tag] ?? TAG_COLORS[index % TAG_COLORS.length];
}

export function TagChip({ tag, onRemove, index = 0 }: { tag: string; onRemove?: () => void; index?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium", tagColor(tag, index))}>
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70 transition-opacity">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
