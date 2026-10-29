import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRexDriver, RexSurfaceProvider } from "../rex-surface.ts";

test(
  "real Rex session, tab, script output, and confirmed cancellation",
  { skip: process.env.PI_TEST_REX !== "1", timeout: 30_000 },
  async () => {
    assert.ok(
      process.env.REX_SESSION,
      "Run this test inside a local Rex terminal",
    );
    const directory = mkdtempSync(join(tmpdir(), "pi-rex-live-"));
    const driver = createRexDriver(process.env.REX_SERVER);
    const provider = new RexSurfaceProvider({
      session: process.env.REX_SESSION!,
      block: process.env.REX_BLOCK,
      driver,
    });
    let session: string | undefined;
    let stopWatch: (() => void) | undefined;
    try {
      session = provider.createSession(
        `pi-rex-test-${randomUUID().slice(0, 8)}`,
        directory,
      );
      const block = provider.createSurface({
        name: "surface-test",
        cwd: directory,
      });
      await provider.waitForShellReady(block);
      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Rex test script did not publish its completion marker",
              ),
            ),
          10_000,
        );
        const watcher = watch(directory, (_event, name) => {
          if (name === "complete") {
            clearTimeout(timer);
            watcher.close();
            resolve();
          }
        });
        stopWatch = () => {
          clearTimeout(timer);
          watcher.close();
        };
      });
      provider.runScript(block, "printf 'REX_SURFACE_OK\\n'; touch complete", {
        scriptPath: join(directory, "test.sh"),
        scriptPreamble: "# Owned Rex smoke test",
      });
      await finished;
      assert.match(await provider.readScreen(block), /REX_SURFACE_OK/);
      assert.equal((await provider.inspectSurface(block)).kind, "present");
      provider.closeSurface(block);
      await provider.waitForSurfaceAbsence(block);
    } finally {
      stopWatch?.();
      if (session) driver.sync(["kill", session]);
      rmSync(directory, { recursive: true });
    }
  },
);
