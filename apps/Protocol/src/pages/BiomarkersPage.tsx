import { useEffect, useState } from "react";
import { Moon, Apple, Activity } from "lucide-react";
import { useAppDispatch } from "../store/hooks";
import { fetchSleep, fetchNutrition, fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import SleepLogger from "../components/biomarkers/SleepLogger";
import NutritionLogger from "../components/biomarkers/NutritionLogger";
import BodyMetricsLogger from "../components/biomarkers/BodyMetricsLogger";
import OuraImportPanel from "../components/biomarkers/OuraImportPanel";

type SubTab = "Sleep" | "Nutrition" | "Body Metrics";

const SUB_TABS: { id: SubTab; icon: React.ReactNode; label: string }[] = [
  { id: "Sleep", icon: <Moon size={14} />, label: "Sleep" },
  { id: "Nutrition", icon: <Apple size={14} />, label: "Nutrition" },
  { id: "Body Metrics", icon: <Activity size={14} />, label: "Body Metrics" },
];

export default function BiomarkersPage() {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<SubTab>("Sleep");

  useEffect(() => {
    dispatch(fetchSleep());
    dispatch(fetchNutrition());
    dispatch(fetchBodyMetrics());
  }, [dispatch]);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Biomarkers
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Track sleep, nutrition, and body metrics to understand your health trends.
        </p>
      </div>

      {/* Sub-tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 4,
          alignSelf: "flex-start",
        }}
      >
        {SUB_TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: "calc(var(--radius) - 2px)",
              fontSize: 13,
              fontWeight: activeTab === id ? 600 : 400,
              background: activeTab === id ? "var(--accent)" : "transparent",
              color: activeTab === id ? "var(--accent-fg)" : "var(--text-muted)",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Active logger */}
      {activeTab === "Sleep" && <SleepLogger />}
      {activeTab === "Nutrition" && <NutritionLogger />}
      {activeTab === "Body Metrics" && <BodyMetricsLogger />}

      <OuraImportPanel onImported={() => {
        dispatch(fetchSleep());
        dispatch(fetchNutrition());
        dispatch(fetchBodyMetrics());
      }} />
    </div>
  );
}
