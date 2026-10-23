// The only interactive code in the CLI, used by `nexus login` alone. Every
// other command is non-interactive by design so scripts and agents can run
// them. The password is read with echo off and never written anywhere.

import readline from "node:readline";
import { UserError } from "./errors.ts";

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new UserError("login needs an interactive terminal (stdin is not a TTY)");
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "") return done(new UserError("cancelled"));
        if (ch === "" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
