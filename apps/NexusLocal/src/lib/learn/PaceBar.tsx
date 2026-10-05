/**
 * Den lagdelte progressbar: grå bund, RØD "hvor jeg burde være", GRØN
 * "hvor jeg er" ovenpå. Grøn dækker rød, så rød kun er synlig som det
 * stykke man er BAGUD — foran eller on-track ser man kun grøn (og evt.
 * grå rest). Ingen expected (null) degraderer til den gamle enkeltbar:
 * uden en frist findes der intet "bagud" at male rødt.
 */
export function PaceBar({ pct, expectedPct, tone = "bg-emerald-500" }: {
  pct: number;
  expectedPct?: number | null;
  tone?: string;
}) {
  const act = Math.min(1, Math.max(0, pct));
  const exp = expectedPct == null ? null : Math.min(1, Math.max(0, expectedPct));
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[#EBEAE5]">
      {exp != null && (
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#E05252]"
          style={{ width: `${Math.round(exp * 100)}%` }} />
      )}
      <div className={`absolute inset-y-0 left-0 rounded-full ${exp != null ? "bg-emerald-500" : tone}`}
        style={{ width: `${Math.round(act * 100)}%` }} />
    </div>
  );
}
