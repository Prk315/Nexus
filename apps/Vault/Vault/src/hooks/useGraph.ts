import { useState, useMemo, useRef } from "react";
import { VaultGraph } from "../types";
import { buildKind } from "../nodeUtils";
import * as api from "../lib/api";
import { invalidateContentCache } from "../components/EditorPane";

export function useGraph() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: {}, edges: {}, back_edges: {}, tag_colors: {} });
  const nodePositions = useRef<Record<string, { x: number; y: number }>>({});

  const graphData = useMemo(() => ({
    nodes: Object.values(graph.nodes).map(n => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      tags: n.tags,
      x: nodePositions.current[n.id]?.x,
      y: nodePositions.current[n.id]?.y,
    })),
    links: Object.entries(graph.edges).flatMap(([source, targets]) =>
      targets.map(target => ({ source, target }))
    ),
  }), [graph]);

  function savePositions(nodes: any[]) {
    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) {
        nodePositions.current[n.id] = { x: n.x, y: n.y };
      }
    }
  }

  async function loadGraph() {
    const g = await api.loadGraph();
    setGraph(g);
  }

  async function createNode(name: string, kind: string) {
    const g = await api.createNode(name, buildKind(kind));
    setGraph(g);
    return g;
  }

  async function deleteNode(id: string) {
    const g = await api.deleteNode(id);
    setGraph(g);
  }

  async function addEdge(fromId: string, toId: string) {
    const g = await api.addEdge(fromId, toId);
    setGraph(g);
  }

  async function removeEdge(fromId: string, toId: string) {
    const g = await api.removeEdge(fromId, toId);
    setGraph(g);
  }

  async function addTag(id: string, tag: string) {
    const g = await api.addTag(id, tag);
    setGraph(g);
  }

  async function removeTag(id: string, tag: string) {
    const g = await api.removeTag(id, tag);
    setGraph(g);
  }

  async function setTagColor(tag: string, color: string) {
    const g = await api.setTagColor(tag, color);
    setGraph(g);
  }

  async function createTag(tag: string, color: string) {
    const g = await api.createTag(tag, color);
    setGraph(g);
  }

  async function renameTag(oldName: string, newName: string) {
    const g = await api.renameTag(oldName, newName);
    setGraph(g);
  }

  async function deleteTagGlobal(tag: string) {
    const g = await api.deleteTagGlobal(tag);
    setGraph(g);
  }

  // Both of these change which save path a node takes, so the pane's cached
  // copy of its content — and api.ts's cached updated_at for it — have to go.
  // Sharing switches a note onto the CRDT path, where the cached copy would
  // become the seed; unsharing switches it back onto the guarded path, where a
  // timestamp that went stale during the co-editing session produces a
  // permanent, unclearable "conflict" on a note nobody else is touching.
  //
  // The whole subtree, because share/unshare are subtree operations.
  function forgetSubtreeContent(rootId: string) {
    for (const id of api.collectDescendants(rootId, graph)) {
      invalidateContentCache(id);
      api.forgetContentVersion(id);
    }
  }

  async function shareNode(id: string) {
    forgetSubtreeContent(id);
    const g = await api.shareNode(id, graph);
    setGraph(g);
  }

  async function unshareNode(id: string) {
    forgetSubtreeContent(id);
    const g = await api.unshareNode(id, graph);
    setGraph(g);
  }

  return { graph, graphData, savePositions, loadGraph, createNode, deleteNode, addEdge, removeEdge, addTag, removeTag, setTagColor, createTag, renameTag, deleteTagGlobal, shareNode, unshareNode };
}
