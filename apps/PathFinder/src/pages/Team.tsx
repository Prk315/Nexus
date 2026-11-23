import { useCallback, useEffect, useState } from "react";
import { Users, ChevronDown, ListTree, Plus } from "lucide-react";
import { Navigator, type Selection } from "../components/workspace/Navigator";
import { TaskBoard } from "../components/workspace/TaskBoard";
import { getMyTeams, createTeam, getTeamMembers } from "../lib/api";
import type { Team as TeamRow, TeamMember } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { SidePane } from "../components/common/SidePane";

// The Team page: same Navigator | TaskBoard shape as Workspace, but scoped to
// one team's shared plans/tasks instead of the signed-in user's own. No
// SystemsRail — systems are personal, and a shared board has more room to
// breathe without a rail nobody on the team but you can act on.
export function Team() {
  const [teams, setTeams] = useState<TeamRow[] | null>(null); // null = still loading
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const [dataVersion, setDataVersion] = useState(0);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  // Inline "new team" field inside the switcher. Before it, the create form
  // only existed while you had ZERO teams — a second team was unreachable.
  const [addingTeam, setAddingTeam] = useState(false);

  const loadTeams = useCallback(async () => {
    const t = await getMyTeams();
    setTeams(t);
    setActiveTeamId((cur) => (cur && t.some((x) => x.id === cur) ? cur : (t[0]?.id ?? null)));
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  useEffect(() => {
    if (!activeTeamId) { setMembers([]); return; }
    let live = true;
    getTeamMembers(activeTeamId).then((m) => { if (live) setMembers(m); }).catch(() => {});
    return () => { live = false; };
  }, [activeTeamId]);

  // A plan/goal selected against the previous team means nothing on this one.
  useEffect(() => { setSelection({ kind: "all" }); }, [activeTeamId]);

  const activeTeam = teams?.find((t) => t.id === activeTeamId) ?? null;

  const handleCreate = async () => {
    const name = newTeamName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const team = await createTeam(name);
      setNewTeamName("");
      setAddingTeam(false);
      setSwitcherOpen(false);
      await loadTeams();
      setActiveTeamId(team.id);
    } finally {
      setCreating(false);
    }
  };

  if (teams === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (teams.length === 0 || !activeTeam) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-500" />
            <h1 className="text-base font-semibold text-foreground">Create a team</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Teams share tasks and plans with the people on them. Create one to get started.
          </p>
          <Input
            autoFocus
            placeholder="Team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
          <Button onClick={handleCreate} disabled={!newTeamName.trim() || creating}>
            {creating ? "Creating…" : "Create team"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header strip: team name (+ switcher when there's more than one) and
          member chips. Kept slim — the board is the point, not this bar. */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Users className="h-4 w-4 text-violet-500 shrink-0" />
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            title="Switch or create team"
            className="flex items-center gap-1 rounded-md px-1 -mx-1 text-sm font-semibold text-foreground hover:text-violet-500 hover:bg-secondary/60 cursor-pointer transition-colors"
          >
            {activeTeam.name}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {switcherOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setSwitcherOpen(false); setAddingTeam(false); }} />
              <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setActiveTeamId(t.id); setSwitcherOpen(false); }}
                    className={cn(
                      "block w-full rounded-md px-2 py-1.5 text-left text-sm",
                      t.id === activeTeamId ? "bg-secondary text-foreground" : "text-foreground/80 hover:bg-secondary/50",
                    )}
                  >
                    {t.name}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                {addingTeam ? (
                  <div className="flex items-center gap-1 p-1">
                    <Input
                      autoFocus
                      placeholder="Team name"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setAddingTeam(false); }}
                      className="h-7 text-xs"
                    />
                    <Button size="sm" className="h-7 px-2" onClick={handleCreate} disabled={!newTeamName.trim() || creating}>
                      {creating ? "…" : "Add"}
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTeam(true)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                  >
                    <Plus className="h-3.5 w-3.5" /> New team
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {members.length > 0 && (
          <div className="flex items-center -space-x-1.5">
            {members.map((m) => (
              <span
                key={m.userId}
                title={m.displayName}
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-violet-500/15 text-[10px] font-semibold text-violet-500"
              >
                {m.displayName.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />
      </div>

      <div className="flex flex-1 min-h-0">
        <SidePane id="team-nav" side="left" label="Plans" icon={ListTree} initial={240} min={190} max={440}>
          {(collapse) => (
            /* Keyed on the team id so switching teams remounts fresh state
               (selection, expanded rows) instead of carrying the old team's
               tree shape into the new one. */
            <Navigator
              key={activeTeam.id}
              selection={selection}
              onSelect={setSelection}
              onDataChange={() => setDataVersion((v) => v + 1)}
              scope={{ kind: "team", teamId: activeTeam.id }}
              onCollapse={collapse}
            />
          )}
        </SidePane>

        <div className="flex-1 min-w-0">
          <TaskBoard
            key={activeTeam.id}
            selectedGoalId={null}
            selectedPlanId={selection.kind === "plan" ? selection.id : null}
            reloadSignal={dataVersion}
            scope={{ kind: "team", teamId: activeTeam.id }}
          />
        </div>
      </div>
    </div>
  );
}
