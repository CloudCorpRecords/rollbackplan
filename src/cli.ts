#!/usr/bin/env node
/**
 * rollbackplan CLI.
 *
 *   rollbackplan plan --input <args.json>
 *   rollbackplan mcp
 *
 * The input file contains the full arguments object:
 * {"release": ..., "migrations": [...], "env_changes": [...],
 * "feature_flags": [...]}.
 * Pure local computation: no network, no configuration, and
 * nothing is executed — the plan only lists the rollback
 * steps. Argument validation happens before any file is read.
 * Exit codes: 0 success, 1 runtime error (including an
 * unreadable or invalid input file, or invalid input naming
 * the offending path), 2 usage error.
 */
import { readFileSync } from "node:fs";
import { formatPayload, planRollback, VERSION } from "./rollbackplan.js";

function usage(): never {
  console.error(`Usage:
  rollbackplan plan --input <args.json>
  rollbackplan mcp
  rollbackplan --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd !== "plan") usage();

  // ---- Argument validation (before any file is read) ----
  const flags = ["--input"];
  if (rest.some((a) => a.startsWith("--") && !flags.includes(a))) usage();
  const inputPath = flag(rest, "--input");
  if (inputPath === undefined) usage();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (err) {
    console.error(
      `error: cannot read or parse input file '${inputPath}': ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  try {
    const out = planRollback(parsed);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
