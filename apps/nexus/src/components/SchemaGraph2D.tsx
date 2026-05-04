import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";

// ── Domain palette ────────────────────────────────────────────────────────────

type Domain = "pathfinder" | "timetracker" | "vault" | "protocol";

const DOMAIN_COLORS: Record<Domain, string> = {
  pathfinder:  "#a78bfa",
  timetracker: "#60a5fa",
  vault:       "#34d399",
  protocol:    "#fb923c",
};

const DOMAIN_LABELS: Record<Domain, string> = {
  pathfinder:  "PathFinder",
  timetracker: "TimeTracker",
  vault:       "Vault",
  protocol:    "Protocol",
};

// ── Schema data ───────────────────────────────────────────────────────────────

interface SchemaNode {
  id: string;
  label: string;
  domain: Domain;
  /** Visual + physics weight: 3=leaf, 5=normal, 7=hub, 9=root */
  val: number;
}

interface SchemaLink {
  source: string;
  target: string;
}

const NODES: SchemaNode[] = [
  // PathFinder — core hierarchy
  { id: "pf_goal_groups",      label: "GoalGroup",      domain: "pathfinder", val: 6 },
  { id: "pf_goals",            label: "Goal",           domain: "pathfinder", val: 9 },
  { id: "pf_lifestyle_areas",  label: "LifestyleArea",  domain: "pathfinder", val: 6 },
  { id: "pf_plans",            label: "Plan",           domain: "pathfinder", val: 9 },
  { id: "pf_tasks",            label: "Task",           domain: "pathfinder", val: 7 },
  { id: "pf_project_goals",    label: "ProjectGoal",    domain: "pathfinder", val: 4 },
  // PathFinder — systems
  { id: "pf_systems",                    label: "System",       domain: "pathfinder", val: 7 },
  { id: "pf_system_subtasks",            label: "SysSubtask",   domain: "pathfinder", val: 4 },
  { id: "pf_system_subtask_completions", label: "SysSubDone",   domain: "pathfinder", val: 3 },
  // PathFinder — daily
  { id: "pf_daily_sections",      label: "DailySection",  domain: "pathfinder", val: 5 },
  { id: "pf_daily_items",         label: "DailyItem",     domain: "pathfinder", val: 4 },
  { id: "pf_daily_completions",   label: "DailyDone",     domain: "pathfinder", val: 3 },
  { id: "pf_routines",            label: "Routine",       domain: "pathfinder", val: 5 },
  { id: "pf_routine_completions", label: "RoutineDone",   domain: "pathfinder", val: 3 },
  { id: "pf_daily_primary_goal",    label: "PrimaryGoal",   domain: "pathfinder", val: 4 },
  { id: "pf_daily_secondary_goals", label: "SecondaryGoal", domain: "pathfinder", val: 4 },
  { id: "pf_time_blocks",           label: "TimeBlock",     domain: "pathfinder", val: 4 },
  // PathFinder — habits
  { id: "pf_habit_stacks",              label: "HabitStack",       domain: "pathfinder", val: 6 },
  { id: "pf_daily_habits",              label: "Habit",            domain: "pathfinder", val: 7 },
  { id: "pf_habit_completions",         label: "HabitDone",        domain: "pathfinder", val: 3 },
  { id: "pf_habit_subtasks",            label: "HabitSubtask",     domain: "pathfinder", val: 4 },
  { id: "pf_habit_subtask_completions", label: "HabitSubDone",     domain: "pathfinder", val: 3 },
  // PathFinder — calendar
  { id: "pf_cal_blocks",           label: "CalBlock",      domain: "pathfinder", val: 5 },
  { id: "pf_recurring_cal_blocks", label: "RecurringBlock",domain: "pathfinder", val: 5 },
  { id: "pf_schedule_entries",     label: "ScheduleEntry", domain: "pathfinder", val: 5 },
  { id: "pf_events",               label: "Event",         domain: "pathfinder", val: 4 },
  { id: "pf_deadlines",            label: "Deadline",      domain: "pathfinder", val: 4 },
  { id: "pf_reminders",            label: "Reminder",      domain: "pathfinder", val: 4 },
  { id: "pf_journal_entries",      label: "Journal",       domain: "pathfinder", val: 4 },
  // PathFinder — pipelines
  { id: "pf_pipeline_templates",     label: "Pipeline",      domain: "pathfinder", val: 6 },
  { id: "pf_pipeline_steps",         label: "PipelineStep",  domain: "pathfinder", val: 4 },
  { id: "pf_pipeline_runs",          label: "PipelineRun",   domain: "pathfinder", val: 5 },
  { id: "pf_pipeline_run_steps",     label: "RunStep",       domain: "pathfinder", val: 3 },
  { id: "pf_pipeline_step_subtasks", label: "StepSubtask",   domain: "pathfinder", val: 3 },
  // PathFinder — courses / books
  { id: "pf_course_assignments", label: "Assignment",    domain: "pathfinder", val: 5 },
  { id: "pf_ca_subtasks",        label: "AssignSubtask", domain: "pathfinder", val: 3 },
  { id: "pf_course_books",       label: "CourseBook",    domain: "pathfinder", val: 5 },
  { id: "pf_book_reading_log",   label: "ReadingLog",    domain: "pathfinder", val: 3 },
  { id: "pf_book_sections",      label: "BookSection",   domain: "pathfinder", val: 4 },
  // PathFinder — fitness / training
  { id: "pf_run_logs",            label: "RunLog",          domain: "pathfinder", val: 4 },
  { id: "pf_workout_logs",        label: "WorkoutLog",      domain: "pathfinder", val: 5 },
  { id: "pf_workout_exercises",   label: "Exercise",        domain: "pathfinder", val: 3 },
  { id: "pf_training_plans",      label: "TrainingPlan",    domain: "pathfinder", val: 6 },
  { id: "pf_training_sessions",   label: "TrainingSession", domain: "pathfinder", val: 5 },
  { id: "pf_session_performance", label: "SessionPerf",     domain: "pathfinder", val: 3 },
  // PathFinder — games
  { id: "pf_games",         label: "Game",        domain: "pathfinder", val: 6 },
  { id: "pf_game_features", label: "GameFeature", domain: "pathfinder", val: 4 },
  { id: "pf_game_devlog",   label: "DevLog",      domain: "pathfinder", val: 3 },
  // PathFinder — standalone
  { id: "pf_roadmap_items", label: "RoadmapItem", domain: "pathfinder", val: 4 },
  { id: "pf_quick_notes",   label: "QuickNote",   domain: "pathfinder", val: 4 },
  { id: "pf_brain_dump",    label: "BrainDump",   domain: "pathfinder", val: 4 },
  { id: "pf_agreements",    label: "Agreement",   domain: "pathfinder", val: 4 },
  { id: "pf_rules",         label: "Rule",        domain: "pathfinder", val: 4 },

  // TimeTracker
  { id: "time_entries",    label: "TimeEntry",     domain: "timetracker", val: 9 },
  { id: "active_sessions", label: "ActiveSession", domain: "timetracker", val: 7 },
  { id: "focus_blocks",    label: "FocusBlock",    domain: "timetracker", val: 5 },
  { id: "blocked_sites",   label: "BlockedSite",   domain: "timetracker", val: 5 },
  { id: "blocked_apps",    label: "BlockedApp",    domain: "timetracker", val: 5 },
  { id: "unlock_rules",    label: "UnlockRule",    domain: "timetracker", val: 5 },

  // Vault
  { id: "vault_nodes",      label: "VaultNode",    domain: "vault", val: 9 },
  { id: "vault_edges",      label: "VaultEdge",    domain: "vault", val: 6 },
  { id: "vault_content",    label: "Content",      domain: "vault", val: 6 },
  { id: "vault_journals",   label: "VaultJournal", domain: "vault", val: 5 },
  { id: "vault_tag_colors", label: "TagColor",     domain: "vault", val: 4 },

  // Protocol
  { id: "protocol_sleep",            label: "Sleep",          domain: "protocol", val: 5 },
  { id: "protocol_body_metrics",     label: "BodyMetrics",    domain: "protocol", val: 5 },
  { id: "protocol_nutrition",        label: "Nutrition",      domain: "protocol", val: 5 },
  { id: "protocol_workout_plans",    label: "WorkoutPlan",    domain: "protocol", val: 7 },
  { id: "protocol_workout_sessions", label: "WorkoutSession", domain: "protocol", val: 6 },
  { id: "protocol_exercises",        label: "Exercise",       domain: "protocol", val: 4 },
  { id: "protocol_running_plans",    label: "RunningPlan",    domain: "protocol", val: 7 },
  { id: "protocol_running_sessions", label: "RunningSession", domain: "protocol", val: 6 },
];

const LINKS: SchemaLink[] = [
  // PathFinder — core
  { source: "pf_goal_groups",     target: "pf_goals" },
  { source: "pf_goals",           target: "pf_plans" },
  { source: "pf_lifestyle_areas", target: "pf_plans" },
  { source: "pf_plans",           target: "pf_tasks" },
  { source: "pf_plans",           target: "pf_project_goals" },
  // systems
  { source: "pf_lifestyle_areas",          target: "pf_systems" },
  { source: "pf_systems",                  target: "pf_system_subtasks" },
  { source: "pf_system_subtasks",          target: "pf_system_subtask_completions" },
  // daily
  { source: "pf_daily_sections",    target: "pf_daily_items" },
  { source: "pf_daily_items",       target: "pf_daily_completions" },
  { source: "pf_routines",          target: "pf_routine_completions" },
  // habits
  { source: "pf_habit_stacks",              target: "pf_daily_habits" },
  { source: "pf_daily_habits",              target: "pf_habit_completions" },
  { source: "pf_daily_habits",              target: "pf_habit_subtasks" },
  { source: "pf_habit_subtasks",            target: "pf_habit_subtask_completions" },
  // calendar
  { source: "pf_cal_blocks", target: "pf_tasks" },
  // pipelines
  { source: "pf_plans",                  target: "pf_pipeline_templates" },
  { source: "pf_pipeline_templates",     target: "pf_pipeline_steps" },
  { source: "pf_pipeline_templates",     target: "pf_pipeline_runs" },
  { source: "pf_pipeline_runs",          target: "pf_pipeline_run_steps" },
  { source: "pf_pipeline_runs",          target: "pf_pipeline_step_subtasks" },
  // courses / books
  { source: "pf_plans",             target: "pf_course_assignments" },
  { source: "pf_course_assignments",target: "pf_ca_subtasks" },
  { source: "pf_plans",             target: "pf_course_books" },
  { source: "pf_course_books",      target: "pf_book_reading_log" },
  { source: "pf_course_books",      target: "pf_book_sections" },
  // fitness
  { source: "pf_workout_logs",       target: "pf_workout_exercises" },
  { source: "pf_training_plans",     target: "pf_training_sessions" },
  { source: "pf_training_sessions",  target: "pf_session_performance" },
  // games
  { source: "pf_games", target: "pf_game_features" },
  { source: "pf_games", target: "pf_game_devlog" },
  // misc plan children
  { source: "pf_plans", target: "pf_roadmap_items" },
  { source: "pf_plans", target: "pf_schedule_entries" },

  // Vault
  { source: "vault_nodes", target: "vault_edges" },
  { source: "vault_nodes", target: "vault_content" },
  { source: "vault_nodes", target: "vault_journals" },

  // Protocol
  { source: "protocol_workout_plans",    target: "protocol_workout_sessions" },
  { source: "protocol_workout_sessions", target: "protocol_exercises" },
  { source: "protocol_running_plans",    target: "protocol_running_sessions" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function SchemaGraph2D() {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [activeDomain, setActiveDomain] = useState<Domain | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    obs.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => obs.disconnect();
  }, []);

  // Configure D3 forces once
  useEffect(() => {
    const fg = fgRef.current as any;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-280);
    fg.d3Force("link")?.distance(70);
  }, []);

  // Filtered graph data
  const graphData = useMemo(() => {
    if (!activeDomain) return { nodes: NODES, links: LINKS };
    const ids = new Set(NODES.filter((n) => n.domain === activeDomain).map((n) => n.id));
    return {
      nodes: NODES.filter((n) => ids.has(n.id)),
      links: LINKS.filter(
        (l) => ids.has(l.source as string) && ids.has(l.target as string)
      ),
    };
  }, [activeDomain]);

  const hoveredNode = useMemo(
    () => NODES.find((n) => n.id === hoveredId) ?? null,
    [hoveredId]
  );

  // Node canvas painter
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.sqrt(node.val ?? 5) * 2.2;
      const color = DOMAIN_COLORS[node.domain as Domain] ?? "#888";
      const isHovered = node.id === hoveredId;
      const isHub = node.val >= 7;

      // Glow
      if (isHovered || isHub) {
        ctx.save();
        ctx.shadowBlur = isHovered ? 18 : 10;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered
        ? color
        : `${color}${isHub ? "dd" : "99"}`;
      ctx.fill();

      // Ring for hub nodes
      if (isHub) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1.5 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = `${color}66`;
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // Label
      const fontSize = Math.max(8, isHub ? 11 : 9) / globalScale;
      ctx.font = `${isHub ? "600" : "400"} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isHovered ? "#ffffff" : "rgba(220,220,240,0.85)";
      ctx.fillText(node.label, node.x, node.y + r + 2.5 / globalScale);
    },
    [hoveredId]
  );

  // Link canvas painter with arrowhead
  const paintLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const src = typeof link.source === "object" ? link.source : null;
      const tgt = typeof link.target === "object" ? link.target : null;
      if (!src || !tgt || src.x == null || tgt.x == null) return;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return;

      const srcColor = DOMAIN_COLORS[src.domain as Domain] ?? "#888";
      const tgtColor = DOMAIN_COLORS[tgt.domain as Domain] ?? "#888";
      const lw = 1 / globalScale;

      // Gradient line
      const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
      grad.addColorStop(0, `${srcColor}55`);
      grad.addColorStop(1, `${tgtColor}99`);

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lw;
      ctx.stroke();

      // Arrowhead at 88% along line
      const angle = Math.atan2(dy, dx);
      const arrowLen = 5.5 / globalScale;
      const spread = Math.PI * 0.35;
      const tx = src.x + dx * 0.88;
      const ty = src.y + dy * 0.88;
      ctx.beginPath();
      ctx.moveTo(tx + arrowLen * Math.cos(angle), ty + arrowLen * Math.sin(angle));
      ctx.lineTo(
        tx + arrowLen * Math.cos(angle + Math.PI - spread),
        ty + arrowLen * Math.sin(angle + Math.PI - spread)
      );
      ctx.lineTo(
        tx + arrowLen * Math.cos(angle + Math.PI + spread),
        ty + arrowLen * Math.sin(angle + Math.PI + spread)
      );
      ctx.closePath();
      ctx.fillStyle = `${tgtColor}bb`;
      ctx.fill();
    },
    []
  );

  // Pointer area for hit-testing
  const paintPointerArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, Math.sqrt(node.val ?? 5) * 2.5, 0, 2 * Math.PI);
      ctx.fill();
    },
    []
  );

  const totalNodes = graphData.nodes.length;
  const totalLinks = graphData.links.length;

  return (
    <div
      style={{
        background: "#08080f",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", letterSpacing: "0.02em" }}>
            NEXUS — Conceptual Model
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
            {totalNodes} entities · {totalLinks} relations
          </span>
        </div>

        {/* Domain filter pills */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setActiveDomain(null)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 99,
              border: `1px solid ${activeDomain === null ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)"}`,
              background: activeDomain === null ? "rgba(255,255,255,0.08)" : "transparent",
              color: activeDomain === null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            All
          </button>
          {(Object.keys(DOMAIN_COLORS) as Domain[]).map((d) => (
            <button
              key={d}
              onClick={() => setActiveDomain(activeDomain === d ? null : d)}
              style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 99,
                border: `1px solid ${activeDomain === d ? DOMAIN_COLORS[d] : "rgba(255,255,255,0.1)"}`,
                background: activeDomain === d ? `${DOMAIN_COLORS[d]}22` : "transparent",
                color: activeDomain === d ? DOMAIN_COLORS[d] : "rgba(255,255,255,0.4)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {DOMAIN_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Graph area */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 480 }}>
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={size.w}
          height={size.h}
          backgroundColor="#08080f"
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => "replace"}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={paintPointerArea}
          nodeLabel={() => ""}
          nodeRelSize={4}
          linkHoverPrecision={4}
          d3VelocityDecay={0.35}
          warmupTicks={80}
          cooldownTime={4000}
          onNodeHover={(node) => setHoveredId(node ? (node as any).id : null)}
        />

        {/* Hover tooltip */}
        {hoveredNode && (
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              background: "rgba(12,12,20,0.92)",
              border: `1px solid ${DOMAIN_COLORS[hoveredNode.domain]}55`,
              borderLeft: `3px solid ${DOMAIN_COLORS[hoveredNode.domain]}`,
              borderRadius: 8,
              padding: "8px 12px",
              pointerEvents: "none",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: DOMAIN_COLORS[hoveredNode.domain] }}>
              {hoveredNode.label}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, fontFamily: "monospace" }}>
              {hoveredNode.id}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
              {DOMAIN_LABELS[hoveredNode.domain]}
            </div>
          </div>
        )}

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            background: "rgba(8,8,15,0.8)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          {(Object.keys(DOMAIN_COLORS) as Domain[]).map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: DOMAIN_COLORS[d],
                  boxShadow: `0 0 6px ${DOMAIN_COLORS[d]}88`,
                }}
              />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                {DOMAIN_LABELS[d]}
              </span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: 3, paddingTop: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 18, height: 2, background: "rgba(255,255,255,0.25)", borderRadius: 1 }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>relation (FK)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
