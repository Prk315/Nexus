import { useEffect, type ReactNode } from "react";

/**
 * The settings drawer: modules, blocked apps/sites, schedules, rewards, device.
 *
 * # Two behaviours, one component
 *
 * The same content has to work on a 179-column desktop window and on an iPhone,
 * and the right answer differs:
 *
 *  - **Wide (`sm:`)**: an inline column that *pushes* the dashboard aside. Both
 *    are usable at once, which is the point — you edit a blocked site and watch
 *    the verdict change next to it.
 *  - **Narrow**: an overlay that slides over the content with a backdrop, because
 *    a 300px push on a 390px-wide phone leaves nothing to push into.
 *
 * Collapsing uses `w-0 + overflow-hidden` on the outer element while the inner
 * content keeps a fixed width. Animating the width of the *content* would reflow
 * every panel inside on each frame of the transition, which is both ugly and
 * expensive; this way the content is simply clipped.
 */

const WIDTH = 320;

export function Sidebar({
  open,
  onClose,
  title = "Settings",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  // Escape closes it. Only bound while open, so it never competes with a panel
  // that wants Escape for its own dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop is narrow-screen only: on desktop the sidebar sits beside the
          content rather than over it, so dimming would be wrong. */}
      {open && (
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 sm:hidden"
        />
      )}

      <aside
        aria-hidden={!open}
        className={`z-40 shrink-0 overflow-hidden border-white/10 bg-[#0c0c12] transition-[width,transform] duration-200 ease-out
          fixed inset-y-0 left-0 sm:static sm:inset-auto
          ${open ? "translate-x-0 border-r" : "-translate-x-full sm:translate-x-0 sm:border-r-0"}
          ${open ? "sm:w-[320px]" : "sm:w-0"}`}
        style={{ width: open ? WIDTH : undefined }}
      >
        {/* Fixed width so the content does not reflow while the width animates. */}
        <div
          className="flex h-full flex-col overflow-y-auto px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]"
          style={{ width: WIDTH }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white/70"
              title="Hide settings (Esc)"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-5">{children}</div>
        </div>
      </aside>
    </>
  );
}

/**
 * The header's toggle. Lives here rather than in the header file so the icon and
 * the panel it controls stay in one place.
 */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? "Hide settings" : "Show settings"}
      aria-expanded={open}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors ${
        open
          ? "border-white/15 bg-white/10 text-white/80"
          : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
      }`}
    >
      {/* A panel glyph rather than a hamburger: this opens a side panel, not a
          nav menu, and the filled left edge shows which side it comes from. */}
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <rect x="1" y="2.5" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1" y="2.5" width="5" height="10" rx="2" fill="currentColor" opacity={open ? 0.9 : 0.35} />
      </svg>
    </button>
  );
}
