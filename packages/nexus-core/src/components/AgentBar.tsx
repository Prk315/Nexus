import { useState, useEffect, useRef } from "react";
import { Bot, X, FolderOpen } from "lucide-react";
import { cn } from "../utils";
import type { AgentConversation, AgentTool, AgentProject } from "../types";

interface AgentBarProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (query: string) => void;
  tools?: AgentTool[];
  conversations?: AgentConversation[];
  projects?: AgentProject[];
  activeProjectId?: string;
  onProjectSelect?: (project: AgentProject) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentBar({
  isOpen,
  onClose,
  onSubmit,
  tools = [],
  conversations = [],
  projects = [],
  activeProjectId,
  onProjectSelect,
}: AgentBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    onSubmit?.(query.trim());
    setQuery("");
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-3xl mx-4 flex rounded-xl border border-border bg-background shadow-2xl overflow-hidden translate-y-16">

        {/* Left sidebar — projects */}
        <div className="w-48 shrink-0 border-r border-border flex flex-col bg-muted/20">
          <div className="px-3 py-2.5 border-b border-border">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Projects
            </span>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-8 px-3">
                <FolderOpen className="h-5 w-5 text-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/40 italic text-center">
                  No projects yet
                </span>
              </div>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onProjectSelect?.(project)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    activeProjectId === project.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  <p className="truncate">{project.name}</p>
                  {project.lastActive && (
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                      {timeAgo(project.lastActive)}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right — tools + input + history */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Mini header — custom tools */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/20">
            <Bot className="h-3.5 w-3.5 text-muted-foreground mr-1 shrink-0" />
            {tools.length > 0 ? (
              tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={tool.onClick}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-accent transition-colors"
                  )}
                >
                  {tool.icon}
                  {tool.label}
                </button>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground/40 italic">
                No tools configured
              </span>
            )}
          </div>

          {/* Input bar */}
          <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything..."
              className={cn(
                "flex-1 bg-transparent text-sm outline-none",
                "placeholder:text-muted-foreground/40 text-foreground"
              )}
            />
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "shrink-0 h-6 w-6 rounded-full",
                "bg-red-500/20 hover:bg-red-500/40 transition-colors",
                "flex items-center justify-center"
              )}
            >
              <X className="h-3.5 w-3.5 text-red-500" />
            </button>
          </form>

          {/* Conversation history */}
          <div className="max-h-64 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-xs text-muted-foreground/40 italic">
                  No previous conversations
                </span>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {conversations.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{c.query}</p>
                      {c.response && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {c.response}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground/50 shrink-0 pt-0.5">
                      {timeAgo(c.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
