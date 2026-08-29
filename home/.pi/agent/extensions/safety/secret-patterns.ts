export type SecretMatch = {
  label: string;
  value: string;
};

const TOKEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { label: "GitHub token", pattern: /gh[pousr]_[0-9A-Za-z]{30,}/g },
  { label: "Anthropic key", pattern: /sk-ant-[0-9A-Za-z_-]{20,}/g },
  { label: "OpenAI key", pattern: /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/g },
  { label: "AWS access key", pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
  { label: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{20,}/g },
];

const QUOTED_ASSIGNMENT =
  /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret|password|authorization)\s*(?:=|:)\s*)(["'])([^"'\r\n]{12,})\2/gi;
const UNQUOTED_ASSIGNMENT =
  /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret|password|authorization)\s*(?:=|:)\s*)([^\s,;#}\]"']{12,})/gi;

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("$") ||
    normalized.startsWith("process.env") ||
    normalized.startsWith("config.") ||
    normalized.startsWith("env.") ||
    normalized.includes("<redacted>") ||
    normalized.includes("<secret>") ||
    normalized.includes("example") ||
    normalized.includes("changeme") ||
    normalized.includes("your_") ||
    /^\*+$/.test(normalized)
  );
}

export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const { label, pattern } of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) matches.push({ label, value: match[0] });
    }
  }

  for (const pattern of [QUOTED_ASSIGNMENT, UNQUOTED_ASSIGNMENT]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = pattern === QUOTED_ASSIGNMENT ? match[3] : match[2];
      if (value && !isPlaceholder(value)) {
        matches.push({ label: "credential assignment", value });
      }
    }
  }

  return matches.filter(
    (match, index) => matches.findIndex((candidate) => candidate.value === match.value) === index,
  );
}

export function cloakSecrets(text: string): { text: string; count: number } {
  const secrets = findSecrets(text).sort((a, b) => b.value.length - a.value.length);
  let cloaked = text;
  let count = 0;

  for (const secret of secrets) {
    if (!cloaked.includes(secret.value)) continue;
    cloaked = cloaked.split(secret.value).join(`[REDACTED ${secret.label}]`);
    count += 1;
  }

  return { text: cloaked, count };
}
