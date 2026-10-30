/**
 * RexOralPanel — entry-kort på Overblik for REX' mundtlige eksamenstræner
 * (RexOralSession). REX har ingen COURSES-post (kurset lever i roadmappen),
 * så kortet er selvbærende: det henter sin egen pool og holder al dataadgang
 * i denne fil i stedet for api.ts — bevidst, så filen ikke konflikter med
 * parallelle api.ts-udvidelser (MLA-eksamenstræneren bygges samtidig).
 *
 * Poolen er `lr_item` under slug-præfikset `rex-gate-` med format
 * `'oral_gate'`, joinet med `lr_item_render` hvor gate-indholdet bor:
 * intro_md = hint 1 (formlen), context_md = hint 2 (teorien),
 * solution_md = facit. Læses med `supabasePublic` — lr_* er anon_all, og
 * den autentificerede klient ville returnere en TOM mængde, ikke en fejl.
 *
 * Rækkefølgen er vægtet mod mindst-øvede: bucket pr. antal forsøg i
 * `lr_attempt_log` (stigende), Fisher–Yates INDEN FOR hver bucket —
 * ExerciseSessions buildCycle-mønster, blot pr. spørgsmål i stedet for pr.
 * problemgruppe. Aldrig-øvede spørgsmål kommer altså altid først, men i
 * tilfældig indbyrdes rækkefølge.
 */

import { useEffect, useState } from "react";
import { supabasePublic } from "../supabase";
import { nodeUserId } from "../nodeUser";
import { RexOralSession } from "./RexOralSession";

export interface OralGateQuestion {
  slug: string;
  section: string;
  sourceRef: string | null;
  prompt: string;
  hint1: string | null;
  hint2: string | null;
  answer: string;
}

async function fetchOralPool(): Promise<OralGateQuestion[]> {
  const { data: items, error } = await supabasePublic
    .from("lr_item")
    .select("item_id, slug, title, prompt, source_ref")
    .like("slug", "rex-gate-%")
    .eq("format", "oral_gate")
    .order("slug");
  if (error) throw new Error(`lr_item: ${error.message}`);
  const rows = (items ?? []) as Array<{ item_id: number; slug: string; title: string; prompt: string; source_ref: string | null }>;
  if (rows.length === 0) return [];
  const { data: renders, error: e2 } = await supabasePublic
    .from("lr_item_render")
    .select("item_id, intro_md, context_md, solution_md")
    .in("item_id", rows.map((r) => r.item_id));
  if (e2) throw new Error(`lr_item_render: ${e2.message}`);
  const renderBy = new Map<number, { intro_md: string | null; context_md: string | null; solution_md: string | null }>();
  for (const r of (renders ?? []) as Array<{ item_id: number; intro_md: string | null; context_md: string | null; solution_md: string | null }>) {
    renderBy.set(r.item_id, r);
  }
  return rows.flatMap((r) => {
    const render = renderBy.get(r.item_id);
    // Et gate-spørgsmål uden facit kan ikke afsluttes — udelad hellere end
    // at vise et kort hvis "Vis facit" åbner en tom boks.
    if (!render?.solution_md) return [];
    return [{
      slug: r.slug,
      section: r.title,
      sourceRef: r.source_ref,
      prompt: r.prompt,
      hint1: render.intro_md,
      hint2: render.context_md,
      answer: render.solution_md,
    }];
  });
}

/** Antal forsøg pr. slug fra attempt-loggen — kun rex-gate-rækker. */
async function fetchAttemptCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabasePublic
    .from("lr_attempt_log")
    .select("item_ref")
    .eq("user_id", await nodeUserId())
    .like("item_ref", "rex-gate-%");
  if (error) throw new Error(`lr_attempt_log: ${error.message}`);
  const out = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ item_ref: string }>) {
    out.set(row.item_ref, (out.get(row.item_ref) ?? 0) + 1);
  }
  return out;
}

/** Bucket efter forsøgstal (stigende), shuffle inden for hver bucket. */
function weightedOrder(pool: OralGateQuestion[], counts: Map<string, number>): OralGateQuestion[] {
  const buckets = new Map<number, OralGateQuestion[]>();
  for (const q of pool) {
    const c = counts.get(q.slug) ?? 0;
    const b = buckets.get(c) ?? [];
    b.push(q);
    buckets.set(c, b);
  }
  const ordered: OralGateQuestion[] = [];
  for (const c of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(c)!;
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    ordered.push(...b);
  }
  return ordered;
}

export function RexOralPanel() {
  // undefined = loader, null = fetch fejlede.
  const [pool, setPool] = useState<OralGateQuestion[] | null | undefined>(undefined);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [sessionQs, setSessionQs] = useState<OralGateQuestion[] | null>(null);

  useEffect(() => {
    if (sessionQs) return; // genindlæs ved luk, så "aldrig øvet" opdateres
    let cancelled = false;
    Promise.all([fetchOralPool(), fetchAttemptCounts()])
      .then(([p, c]) => { if (!cancelled) { setPool(p); setCounts(c); } })
      .catch(() => { if (!cancelled) setPool(null); });
    return () => { cancelled = true; };
  }, [sessionQs]);

  const never = pool ? pool.filter((q) => !counts.has(q.slug)).length : 0;

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">REX · Mundtlig eksamenstræner</h2>
          <p className="mt-0.5 text-xs text-black/50">
            {pool === undefined && "Henter spørgsmål…"}
            {pool === null && "Kunne ikke hente spørgsmålene — prøv igen om lidt."}
            {pool && pool.length === 0 && "Ingen spørgsmål endnu."}
            {pool && pool.length > 0 && (
              <>{pool.length} gate-spørgsmål · {never} aldrig øvet · svar højt, to hints pr. spørgsmål</>
            )}
          </p>
        </div>
        <button
          disabled={!pool || pool.length === 0}
          onClick={() => pool && setSessionQs(weightedOrder(pool, counts))}
          className="shrink-0 rounded-lg bg-[#1A1A24] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Start træning
        </button>
      </div>
      {sessionQs && <RexOralSession questions={sessionQs} onClose={() => setSessionQs(null)} />}
    </section>
  );
}
