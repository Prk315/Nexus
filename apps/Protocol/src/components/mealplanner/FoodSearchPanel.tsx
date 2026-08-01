import { useState } from "react";
import { Search, Plus, X, Loader2 } from "lucide-react";
import { searchFoods, type FoodSearchResult } from "../../lib/nutritionApi";
import { CARD_STYLE, INPUT_STYLE, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import type { CreateFood, Food } from "../../store/types";

const SOURCE_LABEL: Record<FoodSearchResult["source"], string> = {
  usda: "USDA",
  openfoodfacts: "Open Food Facts",
  frida: "Frida (Danish)",
};

const emptyManualFood: CreateFood = {
  source: "manual", external_id: null, name: "", brand: null,
  serving_qty: 100, serving_unit: "g",
  calories: null, protein_g: null, carbs_g: null, fat_g: null,
  fiber_g: null, sugar_g: null, sodium_mg: null, potassium_mg: null,
  calcium_mg: null, iron_mg: null, vitamin_c_mg: null, vitamin_d_mcg: null,
};

export default function FoodSearchPanel({
  localFoods, onPick, onClose,
}: {
  localFoods: Food[];
  onPick: (food: CreateFood, grams: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualFood, setManualFood] = useState<CreateFood>(emptyManualFood);

  const myMatches = query.trim()
    ? localFoods.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const found = await searchFoods(query.trim());
      setResults(found);
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: FoodSearchResult) {
    const food: CreateFood = {
      source: r.source,
      external_id: r.external_id,
      name: r.name,
      brand: r.brand,
      serving_qty: 100,
      serving_unit: "g",
      calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
      fiber_g: r.fiber_g, sugar_g: r.sugar_g, sodium_mg: r.sodium_mg, potassium_mg: r.potassium_mg,
      calcium_mg: r.calcium_mg, iron_mg: r.iron_mg, vitamin_c_mg: r.vitamin_c_mg, vitamin_d_mcg: r.vitamin_d_mcg,
    };
    onPick(food, 100);
  }

  function pickLocal(f: Food) {
    const { id: _id, created_at: _createdAt, ...rest } = f;
    onPick(rest, f.serving_qty || 100);
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualFood.name.trim()) return;
    onPick(manualFood, manualFood.serving_qty || 100);
  }

  const setManual = <K extends keyof CreateFood>(key: K, value: CreateFood[K]) =>
    setManualFood((f) => ({ ...f, [key]: value }));

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 60, zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 480, maxHeight: "80vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Add food</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

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
                <FoodRow key={f.id} name={f.name} brand={f.brand} calories={f.calories} sourceLabel={SOURCE_LABEL[f.source as keyof typeof SOURCE_LABEL] ?? "Logged before"} onAdd={() => pickLocal(f)} />
              ))}
            </div>
          </div>
        )}

        {searching && <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Searching USDA &amp; Open Food Facts…</div>}

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
                    onAdd={() => pickResult(r)}
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
            <form onSubmit={submitManual} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14 }}>
              <div style={FIELD_GROUP}>
                <label style={LABEL_STYLE}>Name</label>
                <input type="text" value={manualFood.name} onChange={(e) => setManual("name", e.target.value)} placeholder="e.g. Mom's lasagna" style={INPUT_STYLE} required />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Values per 100g:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                <div style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>Cal</label>
                  <input type="number" value={manualFood.calories ?? ""} onChange={(e) => setManual("calories", e.target.value ? Number(e.target.value) : null)} style={INPUT_STYLE} />
                </div>
                <div style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>Protein</label>
                  <input type="number" value={manualFood.protein_g ?? ""} onChange={(e) => setManual("protein_g", e.target.value ? Number(e.target.value) : null)} style={INPUT_STYLE} />
                </div>
                <div style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>Carbs</label>
                  <input type="number" value={manualFood.carbs_g ?? ""} onChange={(e) => setManual("carbs_g", e.target.value ? Number(e.target.value) : null)} style={INPUT_STYLE} />
                </div>
                <div style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>Fat</label>
                  <input type="number" value={manualFood.fat_g ?? ""} onChange={(e) => setManual("fat_g", e.target.value ? Number(e.target.value) : null)} style={INPUT_STYLE} />
                </div>
              </div>
              <button type="submit" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                <Plus size={14} /> Add &amp; save to my foods
              </button>
            </form>
          )}
        </div>
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
