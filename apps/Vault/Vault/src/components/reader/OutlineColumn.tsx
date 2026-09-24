// The outline: headings nested by level, concepts as leaves, collapsible.
// Spec §5. Sits left of the concept rail and stays put while the pages scroll.

import { memo, useEffect, useMemo, useState } from "react";
import { activeOutlinePath, buildReaderOutline, type OutlineNode } from "./readerOutline";
import type { ReaderView } from "./readerTypes";

type Props = ReaderView;

export const OutlineColumn = memo(function OutlineColumn({
  pages, visibleBlocks, onNavigate,
}: Props) {
  const tree = useMemo(() => buildReaderOutline(pages), [pages]);
  const path = useMemo(
    () => activeOutlinePath(tree, pages, visibleBlocks),
    [tree, pages, visibleBlocks],
  );

  // Collapsed rather than expanded, so the set is empty on a first render and
  // a branch added by a later document is open by default rather than hidden.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  // Reading into a collapsed branch opens it. Without this the current-position
  // mark lands on a node nobody can see, which is the same as having no mark.
  useEffect(() => {
    if (!path.length) return;
    setCollapsed((prev) => {
      if (!path.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of path) next.delete(id);
      return next;
    });
  }, [path]);

  const active = path.length ? path[path.length - 1] : null;
  const onPath = new Set(path);

  const render = (nodes: OutlineNode[], depth: number) => (
    <ul className="outline-list" style={{ paddingInlineStart: depth === 0 ? 0 : 10 }}>
      {nodes.map((node) => {
        const isCollapsed = collapsed.has(node.id);
        return (
          <li key={node.id} className="outline-item">
            <div
              className={
                `outline-row${node.id === active ? " is-active" : ""}` +
                `${onPath.has(node.id) ? " is-on-path" : ""}`
              }
            >
              {node.children.length > 0 ? (
                <button
                  type="button"
                  className="outline-twisty"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? "Vis underpunkter" : "Skjul underpunkter"}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className="outline-twisty is-leaf" aria-hidden="true" />
              )}

              <button
                type="button"
                className="outline-label"
                data-kind={node.conceptKind ?? `h${node.level}`}
                onClick={() => onNavigate(node.pageIndex, node.id)}
                title={`s. ${pages[node.pageIndex]?.printedPage ?? "?"}`}
              >
                {node.text}
              </button>
            </div>
            {node.children.length > 0 && !isCollapsed && render(node.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  // No "Innhold" heading above it: a column of headings does not need a
  // heading, and the label was a line of chrome in a layout whose rule is that
  // everything on screen is either the page, the rail or the outline.
  return (
    <nav className="reader-outline" aria-label="Innholdsoversikt">
      {tree.length ? render(tree, 0) : <p className="reader-outline-empty">Ingen overskrifter</p>}
    </nav>
  );
});
