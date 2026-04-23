import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { fetchStatistics } from "../store/slices/entriesSlice";
import { formatHours, todayISO, weekStartISO, monthStartISO } from "../lib/formatters";

type Period = "today" | "week" | "month" | "custom";

export default function ReportsPage() {
  const dispatch = useAppDispatch();
  const { statistics, statsLoading } = useAppSelector((s) => s.entries);
  const [period, setPeriod] = useState<Period>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const load = (p: Period) => {
    const today = todayISO();
    const ranges: Record<Period, { start?: string; end?: string }> = {
      today: { start: today, end: today },
      week: { start: weekStartISO(), end: today },
      month: { start: monthStartISO(), end: today },
      custom: { start: customStart || undefined, end: customEnd || undefined },
    };
    const { start, end } = ranges[p];
    dispatch(fetchStatistics({ startDate: start, endDate: end }));
  };

  useEffect(() => { load(period); }, [period]);

  const chartData = (statistics?.by_project ?? []).slice(0, 8).map((p) => ({
    name: p.project ?? "—",
    hours: +(p.total / 3600).toFixed(2),
  }));

  return (
    <div style={{ padding: "16px 20px" }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Reports</h2>

      {/* Period selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["today", "week", "month", "custom"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => { setPeriod(p); if (p !== "custom") load(p); }}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              background: period === p ? "var(--accent)" : "var(--surface-raised)",
              color: period === p ? "var(--accent-fg)" : "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {p === "today" ? "Today" : p === "week" ? "This Week" : p === "month" ? "This Month" : "Custom"}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          <button onClick={() => load("custom")} style={{ background: "var(--accent)", color: "var(--accent-fg)", padding: "6px 14px", borderRadius: "var(--radius-sm)", fontSize: 13 }}>Apply</button>
        </div>
      )}

      {statsLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : statistics ? (
        <>
          <div style={{ fontSize: 24, fontWeight: 300, marginBottom: 20 }}>
            {formatHours(statistics.total_seconds)}
            <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 8 }}>total</span>
          </div>

          {chartData.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>By Project</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                  <XAxis type="number" dataKey="hours" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`${v}h`, "Hours"]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 }} />
                  <Bar dataKey="hours" fill="var(--accent)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {statistics.by_task.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Top Tasks</div>
              {statistics.by_task.map((t) => (
                <div key={t.task_name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{t.task_name}</span>
                  <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{formatHours(t.total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
