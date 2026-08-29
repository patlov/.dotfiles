import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function assistantText(message: { content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

export default function saveMarkdownExtension(pi: ExtensionAPI): void {
  pi.registerCommand("save-md", {
    description: "Save the latest assistant response as Markdown (usage: /save-md name)",
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (!requested) {
        ctx.ui.notify("Usage: /save-md <relative-path>", "warning");
        return;
      }

      const filename = requested.toLowerCase().endsWith(".md") ? requested : `${requested}.md`;
      const outputPath = resolve(ctx.cwd, filename);
      const projectRelative = relative(ctx.cwd, outputPath);
      if (isAbsolute(filename) || projectRelative.startsWith("..") || isAbsolute(projectRelative)) {
        ctx.ui.notify("The output path must stay inside the current working directory.", "error");
        return;
      }
      if (existsSync(outputPath)) {
        ctx.ui.notify(`Refusing to overwrite ${projectRelative}`, "warning");
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      let markdown = "";
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index];
        if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
        markdown = assistantText(entry.message);
        if (markdown) break;
      }

      if (!markdown) {
        ctx.ui.notify("No assistant Markdown response is available to save.", "warning");
        return;
      }

      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${markdown}\n`, { encoding: "utf8", flag: "wx" });
      ctx.ui.notify(`Saved ${projectRelative}`, "info");
    },
  });
}
