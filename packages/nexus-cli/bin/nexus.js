#!/usr/bin/env node
// The `nexus` binary. The CLI is TypeScript and imports `@nexus/core`, whose
// package `exports` point at `.ts` source, so there is no build step: tsx is
// registered as the ESM loader for this process and the entry point is imported
// as-is. `npm link` (or `npm install -g` of this package) puts this on PATH.
import { register } from "tsx/esm/api";

register();
await import("../src/index.ts");
