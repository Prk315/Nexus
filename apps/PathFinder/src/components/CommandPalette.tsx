import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  LayoutDashboard, Kanban, CalendarDays, FolderKanban, BookOpen,
  CalendarRange, Gamepad2, Plus, CornerDownLeft, Search as SearchIcon,
  Target, ListTodo, Repeat,
} from "lucide-react";
import { search as apiSearch, createTask } from "../lib/api";
import type { Page } from "./Sidebar";
import type { SearchResult } from "../types";
import { cn } from "../lib/utils";

const PAGES: { id: Page; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "workspace", label: "Workspace", icon: Kanban },
  { id: "week",      label: "Week",      icon: CalendarDays },
  { id: "projects",  label: "Projects",  icon: FolderKanban },
  { id: "courses",   label: "Study",     icon: BookOpen },
  { id: "schedules", label: "Schedules", icon: CalendarRange },
  { id: "games",     label: "Games",     icon: Gamepad2 },
];

// Every searchable entity currently lives on the Workspace page.
const PAGE_FOR_KIND: Record<SearchResult["kind"], Page> = {
  goal: "workspace", plan: "workspace", task: "workspace", system: "workspace",
};
const ICON_FOR_KIND: Record<SearchResult["kind"], React.ComponentType<{ className?: string }>> = {
  goal: Target, plan: FolderKanban, task: ListTodo, system: Repeat,
};

export function CommandPalette({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); setBusy(false); }
  }, [open]);

  // Debounced entity search (goals/plans/tasks/systems). seq guards against a
  // slow earlier request overwriting a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      apiSearch(q)
        .then((r) => { if (mine === seq.current) setResults(r); })
        .catch(() => { if (mine === seq.current) setResults([]); });
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const go = (page: Page) => { onNavigate(page); setOpen(false); };

  const visiblePages = PAGES.filter(
    (p) => !query.trim() || p.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const quickCapture = async () => {
    const title = query.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createTask({ title, priority: "medium" });
      onNavigate("workspace"); // land where the new task shows up
      setOpen(false);
    } catch {
      setBusy(false); // leave open so the user can retry
    }
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[18%] z-50 w-[92vw] max-w-xl -translate-x-1/2"
      className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks, goals, plans… or jump to a page"
          className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden sm:inline-block rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          ESC
        </kbd>
      </div>

      <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          No matches.
        </Command.Empty>

        {visiblePages.length > 0 && (
          <Command.Group heading="Go to" className="px-1 py-1 text-[11px] font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1">
            {visiblePages.map((p) => (
              <Item key={p.id} icon={p.icon} onSelect={() => go(p.id)}>
                {p.label}
              </Item>
            ))}
          </Command.Group>
        )}

        {results.length > 0 && (
          <Command.Group heading="Results" className="mt-1 px-1 py-1 text-[11px] font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1">
            {results.map((r) => (
              <Item
                key={`${r.kind}-${r.id}`}
                icon={ICON_FOR_KIND[r.kind]}
                value={`${r.kind}-${r.id}-${r.title}`}
                onSelect={() => go(PAGE_FOR_KIND[r.kind])}
                trailing={<span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{r.kind}</span>}
              >
                <span className="truncate">{r.title}</span>
                {r.subtitle && <span className="ml-2 truncate text-xs text-muted-foreground">{r.subtitle}</span>}
              </Item>
            ))}
          </Command.Group>
        )}

        {query.trim() && (
          <Command.Group heading="Create" className="mt-1 px-1 py-1 text-[11px] font-medium text-muted-foreground [&_[cmdk-group-items]]:mt-1">
            <Item icon={Plus} value="__create_task__" onSelect={quickCapture}>
              {busy ? "Creating…" : <>New task <span className="text-muted-foreground">“{query.trim()}”</span></>}
            </Item>
          </Command.Group>
        )}
      </Command.List>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> to select</span>
        <span>PathFinder</span>
      </div>
    </Command.Dialog>
  );
}

function Item({
  icon: Icon, children, onSelect, value, trailing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onSelect: () => void;
  value?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground",
        "data-[selected=true]:bg-secondary data-[selected=true]:text-secondary-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {trailing}
    </Command.Item>
  );
}
