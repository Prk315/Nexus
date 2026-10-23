import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DirectoryShell } from "./DirectoryShell";
import { ErrorFence } from "./ErrorFence";
import { uniGraph } from "./testGraph";

// The one test that can see the bug Bastian hit.
//
// Everything else in this folder is pure and passed while the layout showed
// nothing at all: the flattening was right, the subgraphs were right, and the
// screen was still empty. A pane that renders nothing is invisible to every
// test that does not mount it — so this one mounts the real shell and asserts
// the three regions exist.
//
// It deliberately does NOT reach the canvas: the graph cell measures 0×0 under
// happy-dom, so `ForceGraphView` never mounts and three.js never loads. What is
// being pinned here is the SHELL — header, sidebar, graph cell, folder
// directory — which is exactly the part that was missing.

const graph = uniGraph();
const graphData = {
  nodes: Object.values(graph.nodes).map((n) => ({ id: n.id, name: n.name, kind: n.kind, tags: n.tags })),
  links: Object.entries(graph.edges).flatMap(([source, targets]) =>
    targets.map((target) => ({ source, target })),
  ),
};

const noop = () => {};

function shellProps(over: Record<string, unknown> = {}) {
  return {
    graph,
    graphData,
    selectedId: "Mathematics",
    currentUserId: "27eaf403-c5b4-43d5-aef4-01f37a08e590",
    sidebarWidth: 260,
    sidebarDragging: false,
    onStartResize: noop,
    sidebarView: "list" as const,
    onSidebarView: noop,
    themeOpen: false,
    onToggleTheme: noop,
    tagsSlot: null,
    expanded: new Set(["UNI", "Mathematics"]),
    onToggleExpanded: noop,
    onSelect: noop,
    onDelete: noop,
    onCreate: noop,
    onImport: noop,
    onUnlink: noop,
    onToggleShare: noop,
    linkMode: false,
    linkSource: null,
    onToggleLinkMode: noop,
    onGraphNodeClick: noop,
    onSavePositions: noop,
    onOpenSearch: noop,
    layout: "grid" as const,
    onLayout: noop,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

describe("DirectoryShell renders its three regions", () => {
  it("mounts a header, a sidebar, a graph cell and a folder directory", () => {
    render(<DirectoryShell {...(shellProps() as any)} />);
    expect(host.querySelector(".vault-header"), "the header").not.toBeNull();
    expect(host.querySelector(".dir-sidebar"), "the sidebar").not.toBeNull();
    expect(host.querySelector(".dir-graph"), "the graph cell").not.toBeNull();
    expect(host.querySelector(".dir-folders"), "the folder directory").not.toBeNull();
  });

  it("carries the layout switch, so the toggle is never one-way", () => {
    // The bug: this button lived only here, and pressing it unmounted the
    // header that holds it. App renders the same component in the classic
    // layout; this asserts the shell's half.
    render(<DirectoryShell {...(shellProps() as any)} />);
    expect(host.querySelector(".vault-header .vault-layout-btn")).not.toBeNull();
  });

  it("draws the tree flush left, with a guide strip per level", () => {
    render(<DirectoryShell {...(shellProps() as any)} />);
    const rows = host.querySelectorAll(".dtree-row");
    expect(rows.length).toBeGreaterThan(5);
    // UNI is a root: no guides. Its children carry one column each.
    const uni = [...rows].find((r) => r.textContent?.includes("UNI"))!;
    expect(uni.querySelectorAll(".dtree-guide")).toHaveLength(0);
    const maths = [...rows].find((r) => r.textContent?.includes("Mathematics"))!;
    expect(maths.querySelectorAll(".dtree-guide")).toHaveLength(1);
    // Nothing is indented: depth is in the guides, not in a padding.
    expect((maths as HTMLElement).style.paddingLeft).toBe("");
  });

  it("shows the unknown-kind reader node rather than dropping or throwing on it", () => {
    render(<DirectoryShell {...(shellProps() as any)} />);
    const names = [...host.querySelectorAll(".dtree-name")].map((n) => n.textContent);
    expect(names).toContain("Kalkulus (reader)");
  });

  it("says something in the graph cell when there is nothing to draw", () => {
    render(<DirectoryShell {...(shellProps({ graphData: { nodes: [], links: [] } }) as any)} />);
    expect(host.querySelector(".dir-graph .graph-empty-state")).not.toBeNull();
  });

  it("survives an empty vault", () => {
    const empty = { nodes: {}, edges: {}, back_edges: {}, tag_colors: {} };
    render(
      <DirectoryShell
        {...(shellProps({ graph: empty, graphData: { nodes: [], links: [] }, selectedId: null }) as any)}
      />,
    );
    expect(host.querySelector(".dir-sidebar")).not.toBeNull();
    expect(host.querySelector(".dtree-empty")).not.toBeNull();
  });
});

describe("ErrorFence", () => {
  function Boom(): React.ReactElement {
    throw new Error("kapsule exploded");
  }

  it("shows a message in the pane instead of taking the tree down", () => {
    render(
      <div>
        <span className="sibling">still here</span>
        <ErrorFence label="The graph could not be drawn.">
          <Boom />
        </ErrorFence>
      </div>,
    );
    expect(host.querySelector(".pane-error-title")?.textContent).toBe("The graph could not be drawn.");
    expect(host.querySelector(".pane-error-detail")?.textContent).toBe("kapsule exploded");
    // The rest of the layout is untouched — that is the whole point.
    expect(host.querySelector(".sibling")).not.toBeNull();
  });
});
