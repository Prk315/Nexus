// The board's rendering. Presentational only: it takes a finished view state
// and draws it, so every pane can be rendered to a string in a test without a
// terminal, a timer or an api.
//
// Width discipline: the layout is readable at 100 columns and degrades at 80 by
// dropping the columns that carry the least (plan, then kanban/stage/deadline)
// and giving the freed space back to the title. The title is the content, so it
// is the LAST thing to give way — the same rule Vault's task list row follows.

import React from "react";
import { Box, Text } from "ink";
import {
  PANES,
  PANE_COLUMNS,
  PANE_LABELS,
  headlineCounts,
  scrollWindow,
  type BoardModel,
  type BoardRow,
  type ColumnSpec,
  type PaneId,
} from "./data.ts";

/**
 * The hint has to FIT, or the last keys it names are the ones that get cut off —
 * and `q quit` being invisible in an 80-column pane is the worst possible
 * truncation. Two forms, both measured by a test against the width they serve.
 */
export const KEY_HINT = "j/k move  ⏎ expand  a add  d done  s stage  x status  e edit  D delete  r refresh  / filter  q quit";
export const KEY_HINT_SHORT = "a add  d done  s stage  x status  e edit  D del  r reload  / find  q quit";

export function keyHint(columns: number): string {
  return columns >= KEY_HINT.length ? KEY_HINT : KEY_HINT_SHORT;
}

/** What the board is waiting for. `browse` is the resting state. */
export type Mode =
  | { kind: "browse" }
  | { kind: "prompt"; label: string; value: string; intent: PromptIntent }
  | { kind: "menu"; label: string; options: string[]; index: number; intent: MenuIntent }
  | { kind: "confirm"; label: string };

export type PromptIntent = "add" | "filter" | "edit-title" | "edit-due";
export type MenuIntent = "stage" | "kanban";

export interface BoardViewProps {
  who: { profileName: string; email: string };
  model: BoardModel | null;
  pane: PaneId;
  rows: BoardRow[];
  selected: number;
  status: string;
  statusKind: "info" | "error";
  filter: string;
  mode: Mode;
  /** Terminal size. Defaults keep the snapshots deterministic. */
  columns?: number;
  rowLines?: number;
  loading?: boolean;
}

/** Pad or truncate to exactly `width`, ellipsising rather than spilling. */
export function fit(value: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) return "";
  const v = value ?? "";
  if (v.length > width) return width <= 1 ? v.slice(0, width) : `${v.slice(0, width - 1)}…`;
  return align === "right" ? v.padStart(width) : v.padEnd(width);
}

const MARKER_W = 2;
const ID_W = 5;
const MIN_TITLE_W = 16;

export function visibleColumns(pane: PaneId, columns: number): ColumnSpec[] {
  return PANE_COLUMNS[pane].filter((c) => c.minCols === undefined || columns >= c.minCols);
}

export function titleWidth(pane: PaneId, columns: number): number {
  const cells = visibleColumns(pane, columns).reduce((n, c) => n + c.width + 1, 0);
  return Math.max(MIN_TITLE_W, columns - MARKER_W - ID_W - 1 - cells);
}

function cellsLine(values: string[], specs: ColumnSpec[]): string {
  return specs.map((c, i) => fit(values[i] ?? "", c.width, c.align)).join(" ");
}

/** One row as a single string — what the snapshots compare. */
export function rowLine(row: BoardRow, pane: PaneId, columns: number, selected: boolean): string {
  const marker = selected ? "> " : "  ";
  const tw = titleWidth(pane, columns);
  const specs = visibleColumns(pane, columns);
  if (row.kind === "group" || row.kind === "note") {
    return `${marker}${fit(row.title, columns - MARKER_W)}`.replace(/\s+$/, "");
  }
  const disc = row.expandable ? (row.expanded ? "▾ " : "▸ ") : "  ";
  const indent = "  ".repeat(row.depth);
  const id = row.id == null ? " ".repeat(ID_W) : fit(String(row.id), ID_W, "right");
  const title = fit(`${indent}${disc}${row.title}`, tw);
  return `${marker}${id} ${title} ${cellsLine(row.cells, specs)}`.replace(/\s+$/, "");
}

function headerLine(pane: PaneId, columns: number): string {
  const tw = titleWidth(pane, columns);
  const specs = visibleColumns(pane, columns);
  return `${" ".repeat(MARKER_W)}${fit("id", ID_W, "right")} ${fit("title", tw)} ${cellsLine(
    specs.map((c) => c.label),
    specs,
  )}`.replace(/\s+$/, "");
}

export function tabs(pane: PaneId): string {
  return PANES.map((p, i) => `${i + 1} ${PANE_LABELS[p]}${p === pane ? " •" : ""}`).join("   ");
}

function overlayLine(mode: Mode): string | null {
  switch (mode.kind) {
    case "browse":
      return null;
    case "prompt":
      return `${mode.label}${mode.value}▏`;
    case "menu":
      return `${mode.label} ${mode.options.map((o, i) => (i === mode.index ? `[${o}]` : ` ${o} `)).join(" ")}  (⏎ pick, esc cancel)`;
    case "confirm":
      return `${mode.label} (y/n)`;
  }
}

export function Board(props: BoardViewProps): React.ReactElement {
  const columns = props.columns ?? 100;
  const rowLines = props.rowLines ?? 16;
  const { model, pane, rows, selected } = props;
  const rule = "─".repeat(Math.max(10, columns));

  const { start, end } = scrollWindow(rows.length, selected, rowLines);
  const shown = rows.slice(start, end);

  const warnings: string[] = [];
  if (model?.capped) warnings.push("task read hit the row cap — every count below is a floor");
  if (model?.briefError) warnings.push(`brief unavailable (${model.briefError}) — headline counts unknown, not zero`);

  const overlay = overlayLine(props.mode);
  const tabLine = tabs(pane);
  const countLine = model ? headlineCounts(model) : "";

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{`[${props.who.profileName} <${props.who.email}>]`}</Text>
        <Text>{` nexus board · ${model ? model.today : "…"}${model ? ` · loaded ${clock(model.loadedAt)}` : ""}${props.loading ? " · loading…" : ""}`}</Text>
      </Text>
      {/* Tabs and the headline counts share a line only while both fit whole;
          truncating either would hide a pane number or a count. */}
      {tabLine.length + 2 + countLine.length <= columns ? (
        <Text>
          <Text>{`${tabLine}  `}</Text>
          <Text dimColor>{countLine}</Text>
        </Text>
      ) : (
        <>
          <Text>{fit(tabLine, columns)}</Text>
          <Text dimColor>{fit(countLine, columns)}</Text>
        </>
      )}
      {warnings.map((w) => (
        <Text key={w} color="yellow">{fit(`! ${w}`, columns)}</Text>
      ))}
      {props.filter ? <Text color="cyan">{fit(`filter: ${props.filter}  (/ to change, esc to clear)`, columns)}</Text> : null}
      <Text dimColor>{rule}</Text>
      <Text dimColor>{headerLine(pane, columns)}</Text>
      {shown.length === 0 ? (
        <Text dimColor>{"  (nothing to show)"}</Text>
      ) : (
        shown.map((row, i) => {
          const index = start + i;
          const isSel = index === selected;
          const line = rowLine(row, pane, columns, isSel);
          if (row.kind === "group") return <Text key={row.key} bold color={isSel ? "cyan" : undefined}>{line}</Text>;
          if (row.kind === "note") return <Text key={row.key} dimColor>{line}</Text>;
          return (
            <Text key={row.key} color={isSel ? "cyan" : undefined} bold={isSel}>
              {line}
            </Text>
          );
        })
      )}
      <Text dimColor>{rule}</Text>
      {rows.length > shown.length ? (
        <Text dimColor>{`  ${start + 1}-${end} of ${rows.length}`}</Text>
      ) : (
        <Text dimColor>{`  ${rows.length} rows`}</Text>
      )}
      <Text color={props.statusKind === "error" ? "red" : undefined}>{fit(props.status || " ", columns)}</Text>
      <Text dimColor>{overlay ? fit(overlay, columns) : fit(keyHint(columns), columns)}</Text>
    </Box>
  );
}

function clock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
