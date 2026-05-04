import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getStatistics } from "../lib/tauriApi";
import { todayISO } from "../lib/formatters";
import type { Statistics } from "../store/types";

const SIZE = 180;
const BUDGET_H = 16;

const NAMED: Record<string, string> = {
  nexus: "#F97316",
  uni:   "#2563EB",
};
const PALETTE = ["#8B5CF6","#10B981","#F59E0B","#EF4444","#EC4899","#06B6D4","#84CC16","#F43F5E"];
const REMAINING_FILL = "rgba(120,120,120,0.15)";

function projectColor(name: string, paletteIdx: number): string {
  const key = name.toLowerCase();
  if (NAMED[key]) return NAMED[key];
  return PALETTE[paletteIdx % PALETTE.length];
}

export default function PieFloatingWidget() {
  const [stats, setStats] = useState<Statistics | null>(null);

  const load = async () => {
    try {
      const today = todayISO();
      const s = await getStatistics({ startDate: today, endDate: today });
      setStats(s);
    } catch { /* offline / no data */ }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const startDrag = () => getCurrentWindow().startDragging().catch(() => {});

  const byProject = stats?.by_project ?? [];
  const loggedSeconds = byProject.reduce((s, p) => s + p.total, 0);
  const remainingSeconds = Math.max(0, BUDGET_H * 3600 - loggedSeconds);
  const loggedH = loggedSeconds / 3600;

  let paletteIdx = 0;
  const pieSlices = [
    ...byProject.map((p) => ({
      name: p.project ?? "—",
      value: +(p.total / 3600).toFixed(3),
      color: projectColor(p.project ?? "—", paletteIdx++),
    })),
    ...(remainingSeconds > 0
      ? [{ name: "Remaining", value: +(remainingSeconds / 3600).toFixed(3), color: REMAINING_FILL }]
      : []),
  ];

  return (
    <div
      onMouseDown={startDrag}
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: 18,
        background: "var(--surface)",
        border: "1.5px solid var(--border)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "grab",
        userSelect: "none",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <PieChart width={SIZE} height={SIZE}>
        <Pie
          data={pieSlices}
          cx={SIZE / 2 - 1}
          cy={SIZE / 2 - 1}
          innerRadius={52}
          outerRadius={76}
          startAngle={90}
          endAngle={-270}
          dataKey="value"
          strokeWidth={0}
        >
          {pieSlices.map((s, i) => (
            <Cell key={i} fill={s.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(1)}h`, ""]}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
      </PieChart>

      {/* Centre label */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        textAlign: "center",
        pointerEvents: "none",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
          {loggedH.toFixed(1)}h
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
          of {BUDGET_H}h
        </div>
      </div>
    </div>
  );
}
