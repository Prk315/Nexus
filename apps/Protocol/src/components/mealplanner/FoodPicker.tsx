import { useState } from "react";
import { Search, Plus, ArrowLeft, Loader2 } from "lucide-react";
import { searchFoods, type FoodSearchResult } from "../../lib/nutritionApi";
import { CARD_STYLE, INPUT_STYLE, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import { EMPTY_NUTRIENTS } from "../../lib/nutrients";
import NutrientFields from "./NutrientFields";
import type { CreateFood, Food } from "../../store/types";

const SOURCE_LABEL: Record<FoodSearchResult["source"], string> = {
  usda: "USDA",
  openfoodfacts: "Open Food Facts",
  frida: "Frida (Danish)",
};

const emptyManualFood: CreateFood = {
  ...EMPTY_NUTRIENTS,
  source: "manual", external_id: null, name: "", brand: null,
  serving_qty: 100, serving_unit: "g",
};

function toCreateFood(r: FoodSearchResult): CreateFood {
  return {
    ...EMPTY_NUTRIENTS,
    source: r.source, external_id: r.external_id, name: r.name, brand: r.brand,
    serving_qty: 100, serving_unit: "g",
    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
    fiber_g: r.fiber_g, sugar_g: r.sugar_g, sodium_mg: r.sodium_mg, potassium_mg: r.potassium_mg,
    calcium_mg: r.calcium_mg, iron_mg: r.iron_mg, vitamin_c_mg: r.vitamin_c_mg, vitamin_d_mcg: r.vitamin_d_mcg,
  };
}

/**
 * Search / my-foods / manual-entry flow, ending in a portion-adjust step
 * before calling onPick(food, grams). Embeddable — the parent supplies the
 * modal chrome (this renders just the panel content).
 */
export default function FoodPicker({
  localFoods, onPick,
}: {
  localFoods: Food[];
  onPick: (food: CreateFood, grams: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualFood, setManualFood] = useState<CreateFood>(emptyManualFood);
  const [selected, setSelected] = useState<CreateFood | null>(null);
  const [quantity, setQuantity] = useState(100);

  const myMatches = query.trim()
    ? localFoods.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      setResults(await searchFoods(query.trim()));
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: FoodSearchResult) {
    setSelected(toCreateFood(r));
    setQuantity(100);
  }

  function selectLocal(f: Food) {
    const { id: _id, user_id: _userId, created_at: _createdAt, ...rest } = f;
    setSelected(rest);
    setQuantity(f.serving_qty || 100);
  }

  function selectManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualFood.name.trim()) return;
    setSelected(manualFood);
    setQuantity(manualFood.serving_qty || 100);
  }

  function confirmAdd() {
    if (!selected) return;
    onPick(selected, quantity);
    setSelected(null);
  }

  const setManual = <K extends keyof CreateFood>(key: K, value: CreateFood[K]) =>
    setManualFood((f) => ({ ...f, [key]: value }));

  if (selected) {
    const factor = quantity / 100;
    const scaled = (v: number | null) => (v != null ? Math.round(v * factor * 10) / 10 : null);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={() => setSelected(null)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}
        >
          <ArrowLeft size={13} /> Back
        </button>

        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{selected.name}</div>
          {selected.brand && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{selected.brand}</div>}
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Amount ({selected.serving_unit})</label>
          <input
            type="number"
            value={quantity}
            min={0}
            step={selected.serving_unit === "g" || selected.serving_unit === "ml" ? 5 : 1}
            onChange={(e) => setQuantity(Number(e.target.value) || 0)}
            style={{ ...INPUT_STYLE, fontSize: 16, fontWeight: 600 }}
            autoFocus
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          {([
            ["Cal", scaled(selected.calories), ""],
            ["Protein", scaled(selected.protein_g), "g"],
            ["Carbs", scaled(selected.carbs_g), "g"],
            ["Fat", scaled(selected.fat_g), "g"],
          ] as const).map(([label, val, unit]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{val ?? "—"}{unit}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={confirmAdd}
          disabled={quantity <= 0}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: quantity > 0 ? 1 : 0.5 }}
        >
          <Plus size={14} /> Add {quantity}{selected.serving_unit}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search foods — e.g. chicken breast, banana"
          style={{ ...INPUT_STYLE, flex: 1 }}
          autoFocus
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          {searching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
        </button>
      </form>

      {myMatches.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            My foods
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {myMatches.slice(0, 5).map((f) => (
              <FoodRow key={f.id} name={f.name} brand={f.brand} calories={f.calories} sourceLabel={SOURCE_LABEL[f.source as keyof typeof SOURCE_LABEL] ?? "Logged before"} onAdd={() => selectLocal(f)} />
            ))}
          </div>
        </div>
      )}

      {searching && <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Searching USDA, Open Food Facts &amp; Frida…</div>}

      {!searching && searched && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Results
          </div>
          {results.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
              No matches found in either database.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {results.map((r, i) => (
                <FoodRow
                  key={`${r.source}-${r.external_id}-${i}`}
                  name={r.name}
                  brand={r.brand}
                  calories={r.calories}
                  sourceLabel={SOURCE_LABEL[r.source]}
                  country={r.country}
                  onAdd={() => selectResult(r)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}
        >
          {manualOpen ? "Hide" : "Can't find it? Log it manually"}
        </button>

        {manualOpen && (
          <form onSubmit={selectManual} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14 }}>
            <div style={FIELD_GROUP}>
              <label style={LABEL_STYLE}>Name</label>
              <input type="text" value={manualFood.name} onChange={(e) => setManual("name", e.target.value)} placeholder="e.g. Mom's lasagna" style={INPUT_STYLE} required />
            </div>
            <NutrientFields
              values={manualFood}
              onChange={(k, v) => setManual(k, v)}
              unitNote="Values per 100g / 100ml — fill in only what you know."
            />
            <button type="submit" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              <Plus size={14} /> Next — set portion
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function FoodRow({
  name, brand, calories, sourceLabel, country, onAdd,
}: {
  name: string;
  brand: string | null;
  calories: number | null;
  sourceLabel: string;
  country?: string | null;
  onAdd: () => void;
}) {
  return (
    <button
      onClick={onAdd}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left", width: "100%",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </div>
          {country && (
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", background: "var(--accent-tint)", borderRadius: "var(--radius-sm)", padding: "1px 6px", flexShrink: 0 }}>
              {country}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {brand ? `${brand} · ` : ""}{sourceLabel}{calories != null ? ` · ${Math.round(calories)} kcal/100g` : ""}
        </div>
      </div>
      <Plus size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
    </button>
  );
}
