// Exit-code contract for every command:
//   0  ok
//   1  user error (bad args, not found, refused write, conflict)
//   2  auth error (no session, refresh failed, wrong account)
// Errors are printed to stderr as ONE line so a script can capture them.

export class UserError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class AuthError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof AuthError) return 2;
  if (e instanceof UserError) return 1;
  return 1;
}

export function oneLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s*\n\s*/g, " ").trim();
}
