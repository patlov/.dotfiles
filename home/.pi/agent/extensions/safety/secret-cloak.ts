import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { cloakSecrets, findSecrets } from "./secret-patterns.ts";

function secretWriteReason(labels: string[]): string {
  return `BLOCKED: possible secret in file content (${[...new Set(labels)].join(", ")}). Use an environment variable or an untracked credential store instead.`;
}

export function registerSecretCloak(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    let candidate: string | undefined;

    if (isToolCallEventType("write", event)) {
      candidate = event.input.content;
    } else if (isToolCallEventType("edit", event)) {
      const input = event.input as unknown as {
        newText?: string;
        edits?: Array<{ newText?: string }>;
      };
      candidate = Array.isArray(input.edits)
        ? input.edits.map((edit) => edit.newText ?? "").join("\n")
        : input.newText;
    }

    if (!candidate) return;
    const matches = findSecrets(candidate);
    if (matches.length === 0) return;

    return {
      block: true,
      reason: secretWriteReason(matches.map((match) => match.label)),
    };
  });

  pi.on("tool_result", (event) => {
    let changed = false;
    const content = event.content.map((part) => {
      if (part.type !== "text") return part;
      const result = cloakSecrets(part.text);
      if (result.count === 0) return part;
      changed = true;
      return { ...part, text: result.text };
    });

    return changed ? { content } : undefined;
  });
}
