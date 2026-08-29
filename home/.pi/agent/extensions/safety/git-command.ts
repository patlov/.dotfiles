export function containsGitCommand(command: string): boolean {
  return /(?:^|[;&|\n]\s*)git(?:\s|$)/.test(command);
}

export function containsGitCommit(command: string): boolean {
  return command
    .split(/&&|\|\||[;\n]/)
    .some((segment) => /(?:^|\s)git(?:\s|$)/.test(segment) && /(?:^|\s)commit(?:\s|$)/.test(segment));
}

export function containsGitNoVerify(command: string): boolean {
  return command
    .split(/&&|\|\||[;\n]/)
    .some((segment) => /(?:^|\s)git(?:\s|$)/.test(segment) && /(?:^|\s)--no-verify(?:\s|$)/.test(segment));
}

export function unsafeCommitShape(command: string): string | undefined {
  if (!containsGitCommit(command)) return undefined;
  const commitIndex = command.search(/(?:^|\s)git[^;&|\n]*\scommit(?:\s|$)/);
  const beforeCommit = commitIndex >= 0 ? command.slice(0, commitIndex) : "";
  if (/(?:^|[;&|\n]\s*)git\s+add(?:\s|$)/.test(beforeCommit)) {
    return "Stage files in a separate tool call so the secret guard can inspect the final index.";
  }
  const commitSegment = command
    .split(/&&|\|\||[;\n]/)
    .find((segment) => /(?:^|\s)git(?:\s|$)/.test(segment) && /(?:^|\s)commit(?:\s|$)/.test(segment));
  const commitArgs = commitSegment?.trim().split(/\s+/).slice(2) ?? [];
  if (commitArgs.some((argument) => argument === "--all" || /^-[^-]*a/.test(argument))) {
    return "git commit -a/--all bypasses staged-content inspection; run git add separately first.";
  }
  return undefined;
}
