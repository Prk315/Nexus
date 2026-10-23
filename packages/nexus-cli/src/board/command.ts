// `nexus board` — the TUI, wired to the same PfDeps every `pf` command uses.
//
// Ink and React are pulled in through a dynamic import so that `nexus pf tasks`
// and every other one-shot command keep their current start-up cost; the board
// is the only thing that needs a renderer.

import type { Command } from "commander";
import { UserError } from "../errors.ts";
import type { PfDeps, PfSession } from "../pf/commands.ts";
import { buildModel, type BoardModel, type BriefShape } from "./data.ts";

type Opts = { profile?: string; json?: boolean };

/**
 * One snapshot for all four panes.
 *
 * The brief is loaded through the SAME `PfSession.brief()` that `nexus pf brief`
 * calls, so the board's headline counts and the command's cannot disagree. A
 * brief that fails does not take the board down: the counts become unknown and
 * say so, because "the RPC did not answer" and "nothing is planned" must never
 * look the same.
 */
export async function loadBoardModel(s: PfSession): Promise<BoardModel> {
  const [snapshot, plans, goals] = await Promise.all([s.api.loadTasks(), s.api.loadPlans(), s.api.loadGoals()]);
  let brief: BriefShape | null = null;
  let briefError: string | null = null;
  try {
    brief = (await s.brief()) as BriefShape;
  } catch (e) {
    briefError = (e instanceof Error ? e.message : String(e)).replace(/\s*\n\s*/g, " ").trim();
  }
  return buildModel({ tasks: snapshot.tasks, plans, goals, brief, briefError, capped: snapshot.capped });
}

export function registerBoardCommand(root: Command, deps: PfDeps): void {
  root
    .command("board")
    .description("full-screen roadmap / current / upcoming / progress board (Ink TUI; needs a terminal)")
    .action(async (_o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      if (json) throw new UserError("`board` is interactive and has no --json; use `nexus pf tasks --json`");
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new UserError("`board` needs a terminal (stdin and stdout must be a TTY); use `nexus pf tasks` in a pipe");
      }

      const session = await deps.open(profile);
      const [{ render }, { BoardApp }, React] = await Promise.all([
        import("ink"),
        import("./app.tsx"),
        import("react"),
      ]);

      const instance = render(
        React.createElement(BoardApp, {
          who: session.who,
          api: session.api,
          load: () => loadBoardModel(session),
        }),
        { exitOnCtrlC: true },
      );
      await instance.waitUntilExit();
    });
}
