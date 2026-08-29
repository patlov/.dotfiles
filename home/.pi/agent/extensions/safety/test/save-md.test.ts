import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import saveMarkdownExtension from "../../save-md.ts";

test("save-md writes the latest assistant text without overwriting", async () => {
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const pi = {
    registerCommand(name: string, options: { handler: typeof handler }) {
      assert.equal(name, "save-md");
      handler = options.handler;
    },
  };
  saveMarkdownExtension(pi as any);
  assert.ok(handler);

  const cwd = mkdtempSync(join(tmpdir(), "save-md-test-"));
  const notifications: string[] = [];
  const ctx = {
    cwd,
    ui: { notify(message: string) { notifications.push(message); } },
    sessionManager: {
      getBranch() {
        return [
          { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Older" }] } },
          { type: "message", message: { role: "user", content: [{ type: "text", text: "Next" }] } },
          { type: "message", message: { role: "assistant", content: [{ type: "text", text: "# Latest\n\nBody" }] } },
        ];
      },
    },
  };

  await handler("notes/result", ctx);
  const output = join(cwd, "notes/result.md");
  assert.equal(readFileSync(output, "utf8"), "# Latest\n\nBody\n");

  await handler("notes/result", ctx);
  assert.equal(existsSync(output), true);
  assert.match(notifications.at(-1) ?? "", /Refusing to overwrite/);
});
