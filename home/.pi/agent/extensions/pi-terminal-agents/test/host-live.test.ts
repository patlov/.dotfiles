import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { createRexDriver } from "../rex-surface.ts";

for (const { cancel, count } of [
  { cancel: false, count: 1 },
  { cancel: true, count: 1 },
  { cancel: false, count: 2 },
]) {
  test(
    `upstream host ${cancel ? "cancels once without retry" : `automatically delivers ${count} real Pi result(s)`} in Rex`,
    {
      skip: process.env.PI_TEST_REX_HOST !== "1",
      timeout: 110_000,
    },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "pi-rex-host-"));
      const fixture = fileURLToPath(
        new URL("./fixtures/host-smoke.ts", import.meta.url),
      );
      const child = spawn(
        "pi",
        [
          "--no-extensions",
          "--no-mcp",
          "--no-skills",
          "--session",
          join(directory, "parent.jsonl"),
          "-e",
          fixture,
          "--mode",
          "rpc",
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            PI_REX_TEST_CANCEL: cancel ? "1" : "0",
            PI_REX_TEST_COUNT: String(count),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const events: { type: string; data: unknown }[] = [];
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const streams = [child.stdout, child.stderr].map((input) =>
        createInterface({ input }),
      );
      let expire: ReturnType<typeof setTimeout> | undefined;
      const closed = new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
      const finished = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        expire = setTimeout(
          () =>
            reject(
              new Error(
                `Host smoke test timed out: ${JSON.stringify(events)}\n${stderr}`,
              ),
            ),
          95_000,
        );
        for (const lines of streams)
          lines.on("line", (line) => {
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }
            if (!event.type?.startsWith("rex_test_")) return;
            events.push(event);
            if (
              events.filter((row) => row.type === "rex_test_result").length ===
                count &&
              (!cancel || events.some((row) => row.type === "rex_test_cancel"))
            )
              resolve();
            if (
              event.type === "rex_test_error" ||
              event.type === "rex_test_timeout"
            )
              reject(new Error(JSON.stringify(events)));
          });
        child.once("exit", (code) =>
          reject(
            new Error(
              `Parent exited early (${code}): ${JSON.stringify(events)}\n${stderr}`,
            ),
          ),
        );
      });
      try {
        await finished;
        const results = events.filter(
          (event) => event.type === "rex_test_result",
        );
        assert.equal(results.length, count, JSON.stringify(events));
        assert.match(
          JSON.stringify(results[0].data),
          cancel ? /cancelled/ : /REX_HOST_OK/,
        );
        if (cancel)
          assert.match(
            JSON.stringify(
              events.find((event) => event.type === "rex_test_cancel"),
            ),
            /confirmed|already-terminal/,
          );
      } finally {
        clearTimeout(expire);
        child.stdin.destroy();
        child.kill("SIGTERM");
        await closed;
        for (const lines of streams) lines.close();
        const sessionEvent = events.find(
          (event) => event.type === "rex_test_session",
        );
        const session = (
          sessionEvent?.data as { sessionId?: string } | undefined
        )?.sessionId;
        if (session)
          createRexDriver(process.env.REX_SERVER).sync(["kill", session]);
        rmSync(directory, { recursive: true });
      }
    },
  );
}
