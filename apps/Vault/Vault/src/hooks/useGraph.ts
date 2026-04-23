import { useState, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VaultGraph } from "../types";
import { buildKind } from "../nodeUtils";

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
    const g = await invoke<VaultGraph>("get_graph");
    setGraph(g);
  }

  async function createNode(name: string, kind: string) {
    const g = await invoke<VaultGraph>("create_node", { name, kind: buildKind(kind) });
    setGraph(g);
    return g;
  }

  async function deleteNode(id: string) {
    const g = await invoke<VaultGraph>("delete_node", { id });
    setGraph(g);
  }

  async function addEdge(fromId: string, toId: string) {
    const g = await invoke<VaultGraph>("add_edge", { fromId, toId });
    setGraph(g);
  }

  async function removeEdge(fromId: string, toId: string) {
    const g = await invoke<VaultGraph>("remove_edge", { fromId, toId });
    setGraph(g);
  }

  async function addTag(id: string, tag: string) {
    const g = await invoke<VaultGraph>("add_tag", { id, tag });
    setGraph(g);
  }

  async function removeTag(id: string, tag: string) {
    const g = await invoke<VaultGraph>("remove_tag", { id, tag });
    setGraph(g);
  }

  async function setTagColor(tag: string, color: string) {
    const g = await invoke<VaultGraph>("set_tag_color", { tag, color });
    setGraph(g);
  }

  async function createTag(tag: string, color: string) {
    const g = await invoke<VaultGraph>("create_tag", { tag, color });
    setGraph(g);
  }

  async function renameTag(oldName: string, newName: string) {
    const g = await invoke<VaultGraph>("rename_tag", { oldName, newName });
    setGraph(g);
  }

  async function deleteTagGlobal(tag: string) {
    const g = await invoke<VaultGraph>("delete_tag_global", { tag });
    setGraph(g);
  }

  return { graph, graphData, savePositions, loadGraph, createNode, deleteNode, addEdge, removeEdge, addTag, removeTag, setTagColor, createTag, renameTag, deleteTagGlobal };
}
