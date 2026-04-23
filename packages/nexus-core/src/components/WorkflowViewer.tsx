import { useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X } from "lucide-react";
import { cn } from "../utils";
import type { N8nWorkflow, N8nNode } from "../types";

// ── Node color coding by type category ───────────────────────────────────────

function nodeColor(type: string): string {
  if (type.includes("trigger") || type.includes("webhook") || type.includes("cron"))
    return "bg-emerald-500/20 border-emerald-500/50 text-emerald-400";
  if (type.includes("if") || type.includes("switch") || type.includes("merge"))
    return "bg-orange-500/20 border-orange-500/50 text-orange-400";
  if (type.includes("code") || type.includes("function") || type.includes("script"))
    return "bg-yellow-500/20 border-yellow-500/50 text-yellow-400";
  if (type.includes("http") || type.includes("graphql") || type.includes("api"))
    return "bg-blue-500/20 border-blue-500/50 text-blue-400";
  if (type.includes("set") || type.includes("edit") || type.includes("transform"))
    return "bg-violet-500/20 border-violet-500/50 text-violet-400";
  return "bg-muted border-border text-muted-foreground";
}

function formatType(type: string): string {
  return type
    .replace("n8n-nodes-base.", "")
    .replace("n8n-nodes-", "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

// ── Custom n8n node ───────────────────────────────────────────────────────────

function N8nFlowNode({ data }: NodeProps) {
  const { label, nodeType, onSelect } = data as {
    label: string;
    nodeType: string;
    onSelect: () => void;
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        "px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer",
        "min-w-[120px] text-center shadow-sm select-none",
        "hover:brightness-110 transition-all",
        nodeColor(nodeType)
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border !border-border" />
      <p className="font-semibold truncate">{label}</p>
      <p className="text-[10px] opacity-60 mt-0.5 truncate">{formatType(nodeType)}</p>
      <Handle type="source" position={Position.Right} className="!bg-border !border-border" />
    </div>
  );
}

const nodeTypes = { n8nNode: N8nFlowNode };

// ── Conversion helpers ────────────────────────────────────────────────────────

function toFlowNodes(nodes: N8nNode[], onSelect: (n: N8nNode) => void): Node[] {
  return nodes.map((node) => ({
    id: node.id ?? node.name,
    position: { x: node.position[0], y: node.position[1] },
    type: "n8nNode",
    data: {
      label: node.name,
      nodeType: node.type,
      onSelect: () => onSelect(node),
    },
  }));
}

function toFlowEdges(
  connections: N8nWorkflow["connections"],
  nodes: N8nNode[]
): Edge[] {
  const edges: Edge[] = [];
  const idByName = Object.fromEntries(nodes.map((n) => [n.name, n.id ?? n.name]));

  for (const [sourceName, outputs] of Object.entries(connections)) {
    outputs.main?.forEach((conns, outIdx) => {
      conns?.forEach((conn, connIdx) => {
        edges.push({
          id: `${sourceName}-${conn.node}-${outIdx}-${connIdx}`,
          source: idByName[sourceName],
          target: idByName[conn.node],
          animated: true,
          style: { stroke: "hsl(var(--border))" },
        });
      });
    });
  }

  return edges;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function NodeDetail({ node, onClose }: { node: N8nNode; onClose: () => void }) {
  return (
    <div className="absolute top-2 right-2 z-10 w-64 rounded-lg border border-border bg-background shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold truncate">{node.name}</span>
        <button
          onClick={onClose}
          className="h-5 w-5 rounded-full bg-red-500/20 hover:bg-red-500/40 transition-colors flex items-center justify-center shrink-0"
        >
          <X className="h-3 w-3 text-red-500" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Type</p>
        <p className="text-xs text-foreground">{formatType(node.type)}</p>
      </div>

      {node.parameters && Object.keys(node.parameters).length > 0 ? (
        <div className="px-3 py-2 overflow-y-auto max-h-48">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Parameters</p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(node.parameters).map(([key, value]) => (
              <div key={key}>
                <p className="text-[10px] text-muted-foreground">{key}</p>
                <p className="text-xs text-foreground truncate">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-3 py-3">
          <p className="text-xs text-muted-foreground/50 italic">No parameters</p>
        </div>
      )}
    </div>
  );
}

// ── WorkflowViewer ────────────────────────────────────────────────────────────

interface WorkflowViewerProps {
  workflow?: N8nWorkflow;
  className?: string;
}

const MOCK_WORKFLOW: N8nWorkflow = {
  name: "Example Workflow",
  nodes: [
    { id: "1", name: "Webhook", type: "n8n-nodes-base.webhook", position: [100, 200], parameters: { path: "/webhook", method: "POST" } },
    { id: "2", name: "Transform Data", type: "n8n-nodes-base.code", position: [320, 200], parameters: { language: "javascript" } },
    { id: "3", name: "Check Condition", type: "n8n-nodes-base.if", position: [540, 200], parameters: { condition: "value > 0" } },
    { id: "4", name: "HTTP Request", type: "n8n-nodes-base.httpRequest", position: [760, 120], parameters: { url: "https://api.example.com", method: "POST" } },
    { id: "5", name: "Send Email", type: "n8n-nodes-base.emailSend", position: [760, 300], parameters: { to: "user@example.com" } },
  ],
  connections: {
    Webhook: { main: [[{ node: "Transform Data", type: "main", index: 0 }]] },
    "Transform Data": { main: [[{ node: "Check Condition", type: "main", index: 0 }]] },
    "Check Condition": { main: [
      [{ node: "HTTP Request", type: "main", index: 0 }],
      [{ node: "Send Email", type: "main", index: 0 }],
    ]},
  },
};

export function WorkflowViewer({ workflow = MOCK_WORKFLOW, className }: WorkflowViewerProps) {
  const [selectedNode, setSelectedNode] = useState<N8nNode | null>(null);

  const handleSelect = useCallback((node: N8nNode) => {
    setSelectedNode((prev) => (prev?.name === node.name ? null : node));
  }, []);

  const nodes = toFlowNodes(workflow.nodes, handleSelect);
  const edges = toFlowEdges(workflow.connections, workflow.nodes);

  return (
    <div className={cn("relative w-full h-full min-h-[400px] rounded-lg border border-border overflow-hidden bg-background", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="hsl(var(--border))" gap={20} size={1} />
        <Controls className="[&>button]:bg-background [&>button]:border-border [&>button]:text-foreground" />
      </ReactFlow>

      {selectedNode && (
        <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {workflow.name && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm border border-border">
          <p className="text-xs text-muted-foreground">{workflow.name}</p>
        </div>
      )}
    </div>
  );
}
