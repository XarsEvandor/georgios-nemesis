/**
 * Claude for the Nemesis companion: `claude -p` with a JSON Schema, so the answer comes back as
 * structured output the companion can check. It runs on the GM's Claude subscription, with no
 * tools, none of the GM's own Claude Code settings, and a neutral working folder.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface StructuredRequest {
  /** The task, sent on stdin. */
  prompt: string;
  /** Who Claude is and the rules it follows. */
  system: string;
  /** The JSON Schema the answer must match. */
  schema: object;
  model?: string;
  timeoutMs?: number;
}

/** Anything that turns a request into structured output (the CLI, or a fake in tests). */
export interface ClaudeRunner {
  structured(req: StructuredRequest): Promise<unknown>;
}

/** NEMESIS_CLAUDE, else the Claude Code binary bundled with the VS Code extension (newest), else `claude`. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEMESIS_CLAUDE) return env.NEMESIS_CLAUDE;
  const home = env.USERPROFILE ?? env.HOME ?? "";
  try {
    const ext = join(home, ".vscode", "extensions");
    for (const d of readdirSync(ext).filter((x) => x.startsWith("anthropic.claude-code")).sort().reverse()) {
      const exe = join(ext, d, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude");
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* no VS Code extensions folder */
  }
  return "claude";
}

export class ClaudeCli implements ClaudeRunner {
  constructor(private readonly o: { exe?: string; model?: string } = {}) {}

  async structured(req: StructuredRequest): Promise<unknown> {
    // A neutral folder: claude collects CLAUDE.md files from its working folder upwards.
    const cwd = join(tmpdir(), "georgios-nemesis-claude");
    await mkdir(cwd, { recursive: true });
    const systemFile = join(cwd, `system-${process.pid}-${Date.now()}.md`);
    await writeFile(systemFile, req.system);
    const argv = [
      "-p", "--output-format", "json",
      "--json-schema", JSON.stringify(req.schema),
      "--system-prompt-file", systemFile,
      "--tools", "",
      "--setting-sources", "local",
      "--no-session-persistence",
      "--model", req.model ?? this.o.model ?? "opus",
    ];
    // A set ANTHROPIC_API_KEY would switch claude -p to API billing; the subscription is meant.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.o.exe ?? findClaude(), argv, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Claude took longer than ${Math.round((req.timeoutMs ?? 300_000) / 1000)} s`));
      }, req.timeoutMs ?? 300_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`could not start Claude Code (${e.message}). Is it installed and signed in?`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`Claude Code exited (${code}): ${(stderr || stdout).trim().slice(0, 400)}`));
      });
      child.stdin.end(req.prompt);
    });
    let r: { is_error?: boolean; result?: unknown; structured_output?: unknown; subtype?: string };
    try {
      r = JSON.parse(out);
    } catch {
      throw new Error(`Claude Code gave no JSON: ${out.slice(0, 200)}`);
    }
    if (r.is_error) throw new Error(`Claude: ${String(r.result ?? r.subtype ?? "error")}`);
    if (r.structured_output === undefined) throw new Error("Claude gave no structured output");
    return r.structured_output;
  }
}
