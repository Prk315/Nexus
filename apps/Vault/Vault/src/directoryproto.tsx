// Harness entry — see directoryproto.html.
//
// Mounts the REAL DirectoryShell on a fixture graph with no session, no App and
// no Supabase client, then reports what happened into #status so a headless
// fetch (or a glance) can tell "the shell renders" from "the shell threw"
// without a browser session or a signed-in dev account.
//
// The fixture is the seeded dev vault's shape, INCLUDING the `Reader` node
// whose kind this branch does not know — the one node most likely to throw.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DirectoryShell } from "./components/directory/DirectoryShell";
import { VaultGraph, VaultNode, NodeKind } from "./types";
import "./tailwind.css";
import "./App.css";

const OWNER = "27eaf403-c5b4-43d5-aef4-01f37a08e590";

function fixture(): VaultGraph {
  const nodes: Record<string, VaultNode> = {};
  const edges: Record<string, string[]> = {};
  const back_edges: Record<string, string[]> = {};

  const add = (id: string, kind: string, tags: string[], parent: string | null) => {
    nodes[id] = { id, name: id, kind: { type: kind } as NodeKind, tags, user_id: OWNER, team_id: null };
    if (parent) {
      (edges[parent] ??= []).push(id);
      (back_edges[id] ??= []).push(parent);
    }
  };

  add("UNI", "Folder", [], null);
  const subjects: [string, string][] = [
    ["Mathematics", "math"],
    ["Information Systems", "information-systems"],
    ["Robotics", "robots"],
    ["Quantum Engineering", "quantum-engineering"],
  ];
  for (const [subject, tag] of subjects) {
    add(subject, "Folder", [tag], "UNI");
    for (let i = 1; i <= 5; i++) add(`${subject} ${i}`, "Folder", [tag], subject);
  }
  // The kind this build has never heard of.
  add("Kalkulus (reader)", "Reader", ["math"], "Mathematics");
  // A note, so the folder-only minimap has something to leave out.
  add("Loose note", "Note", ["math"], "Mathematics");

  return {
    nodes,
    edges,
    back_edges,
    tag_colors: { math: "#3b82f6", robots: "#ef4444", "information-systems": "#14b8a6" },
  };
}

const graph = fixture();
const graphData = {
  nodes: Object.values(graph.nodes).map((n) => ({ id: n.id, name: n.name, kind: n.kind, tags: n.tags })),
  links: Object.entries(graph.edges).flatMap(([source, targets]) =>
    targets.map((target) => ({ source, target })),
  ),
};

const status = document.getElementById("status")!;
function report(state: "ok" | "failed", message: string) {
  status.dataset.state = state;
  status.textContent = message;
  status.style.background = state === "ok" ? "#e7f6ec" : "#fdecec";
}

// Anything that escapes React lands here, which is the whole point: a rejected
// lazy import does not throw where it was written.
window.addEventListener("error", (e) => report("failed", `uncaught: ${e.message}`));
window.addEventListener("unhandledrejection", (e) =>
  report("failed", `unhandled rejection: ${(e.reason as Error)?.message ?? String(e.reason)}`),
);

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>("Mathematics");
  const [sidebarView, setSidebarView] = useState<"list" | "graph" | "tags" | "bin">("list");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["UNI", "Mathematics"]));
  const noop = () => {};

  return (
    <DirectoryShell
      graph={graph}
      graphData={graphData}
      selectedId={selectedId}
      currentUserId={OWNER}
      sidebarWidth={260}
      sidebarDragging={false}
      onStartResize={noop}
      sidebarView={sidebarView}
      onSidebarView={setSidebarView}
      themeOpen={false}
      onToggleTheme={noop}
      tagsSlot={<div style={{ padding: 12, fontSize: 12 }}>tags panel (not in the harness)</div>}
      binSlot={<div style={{ padding: 12, fontSize: 12 }}>bin panel (not in the harness)</div>}
      editorSlot={<div style={{ padding: 12, fontSize: 12 }}>editor (not in the harness)</div>}
      expanded={expanded}
      onToggleExpanded={(id) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        })
      }
      onSelect={setSelectedId}
      onDelete={noop}
      onCreate={noop}
      onImport={noop}
      onUnlink={noop}
      onToggleShare={noop}
      linkMode={false}
      linkSource={null}
      onToggleLinkMode={noop}
      onGraphNodeClick={setSelectedId}
      onSavePositions={noop}
      onOpenSearch={noop}
      layout="grid"
      onLayout={noop}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

// One frame later, say what is actually on the page. Region by region, because
// "it rendered" and "the graph cell is empty" are different answers.
setTimeout(() => {
  if (status.dataset.state === "failed") return;
  const found = [".vault-header", ".dir-sidebar", ".dir-graph", ".dir-folders"].filter((sel) =>
    document.querySelector(sel),
  );
  const rows = document.querySelectorAll(".dtree-row").length;
  if (found.length === 4 && rows > 0) {
    report("ok", `ok — header, sidebar (${rows} rows), graph and folder directory all mounted`);
  } else {
    report("failed", `missing regions: ${["header", "sidebar", "graph", "folders"].filter((_, i) =>
      !document.querySelector([".vault-header", ".dir-sidebar", ".dir-graph", ".dir-folders"][i]),
    ).join(", ") || "none"} · tree rows: ${rows}`);
  }
}, 1200);
