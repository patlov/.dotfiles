import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { containsGitCommand, containsGitCommit, containsGitNoVerify, unsafeCommitShape } from "./git-command.ts";
import { findSecrets } from "./secret-patterns.ts";

const GIT_ENV_PREFIX =
  "export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no";
const MAX_STAGED_FILE_BYTES = 2 * 1024 * 1024;

function commitWorkingDirectory(command: string, cwd: string): string {
  const commitSegment = command
    .split(/&&|\|\||[;\n]/)
    .find((segment) => /(?:^|\s)git(?:\s|$)/.test(segment) && /(?:^|\s)commit(?:\s|$)/.test(segment));
  if (!commitSegment) return cwd;

  const match = commitSegment.match(/(?:^|\s)git\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  const requested = match?.[1] ?? match?.[2] ?? match?.[3];
  return requested ? resolve(cwd, requested) : cwd;
}

async function inspectStagedFiles(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string[]> {
  const listed = await pi.exec(
    "git",
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    { cwd, timeout: 10_000 },
  );
  if (listed.code !== 0) return [];

  const findings: string[] = [];
  for (const path of listed.stdout.split("\0").filter(Boolean)) {
    const sizeResult = await pi.exec("git", ["cat-file", "-s", `:${path}`], {
      cwd,
      timeout: 5_000,
    });
    const size = Number.parseInt(sizeResult.stdout.trim(), 10);
    if (Number.isFinite(size) && size > MAX_STAGED_FILE_BYTES) {
      findings.push(`${path}: exceeds the 2 MB secret-scan limit`);
      continue;
    }

    const content = await pi.exec("git", ["show", `:${path}`], { cwd, timeout: 5_000 });
    if (content.code !== 0) continue;
    const labels = [...new Set(findSecrets(content.stdout).map((match) => match.label))];
    if (labels.length > 0) findings.push(`${path}: ${labels.join(", ")}`);
  }

  return findings;
}

export function registerGitInterceptor(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = event.input.command;
    if (!containsGitCommand(command)) return;

    if (containsGitNoVerify(command)) {
      return {
        block: true,
        reason: "BLOCKED: agents may not bypass Git hooks with --no-verify. Fix the hook failure instead.",
      };
    }

    const unsafeShape = unsafeCommitShape(command);
    if (unsafeShape) return { block: true, reason: `BLOCKED: ${unsafeShape}` };

    if (containsGitCommit(command)) {
      const findings = await inspectStagedFiles(pi, commitWorkingDirectory(command, ctx.cwd));
      if (findings.length > 0) {
        return {
          block: true,
          reason: `BLOCKED: staged secret scan found:\n${findings.join("\n")}`,
        };
      }
    }

    event.input.command = `${GIT_ENV_PREFIX}\n${command}`;
  });
}
