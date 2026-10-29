import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RexSurfaceProvider, type RexDriver } from "../rex-surface.ts";

function fixture() {
  const calls: string[][] = [];
  let blocks = [
    { block_id: "block:child", window_id: "window:child", host_id: "local" },
  ];
  let unavailable = false;
  const respond = (args: string[]) => {
    calls.push(args);
    if (unavailable) throw new Error("server disconnected");
    if (args[0] === "whoami")
      return JSON.stringify({
        host_id: "local",
        endpoint: "unix:///tmp/rex.sock",
      });
    if (args[0] === "ls")
      return JSON.stringify({
        sessions: [
          { session_id: "session:origin" },
          { session_id: "session:new" },
        ],
      });
    if (args[0] === "new") return JSON.stringify({ session_id: "session:new" });
    if (args[0] === "window" || args[0] === "run")
      return JSON.stringify({
        block_ids: ["block:child"],
        window_id: "window:child",
      });
    if (args[0] === "block" && args[1] === "ls")
      return JSON.stringify({ blocks });
    if (args[0] === "block" && args[1] === "close") {
      blocks = [];
      return "";
    }
    if (args[0] === "block" && args[1] === "call")
      return JSON.stringify({
        last_exit: null,
        child: { pid: 10, name: "bash" },
        foreground: { pid: 11, name: "node", argv0: "pi", cwd: "/repo" },
        ancestors: [{ pid: 10, name: "bash" }],
      });
    return "";
  };
  const driver: RexDriver = {
    sync: respond,
    async: async (args) => respond(args),
  };
  const provider = new RexSurfaceProvider({
    session: "session:origin",
    block: "block:parent",
    driver,
  });
  return {
    provider,
    calls,
    driver,
    disconnect: () => {
      unavailable = true;
    },
  };
}

test("rejects empty or flag-like labels before creating resources", () => {
  const { provider, calls } = fixture();
  assert.throws(() => provider.createSession("", "/repo"), /nonempty/);
  assert.throws(() => provider.createSession("--", "/repo"), /dash/);
  assert.throws(
    () => provider.createSurface({ name: "--", cwd: "/repo" }),
    /dash/,
  );
  assert.equal(calls.length, 0);
});

test("opens a named tab without stealing focus or loading shell configuration", () => {
  const { provider, calls } = fixture();
  assert.equal(
    provider.createSurface({ name: "pr-123-review", cwd: "/path with spaces" }),
    "block:child",
  );
  assert.deepEqual(calls[1], [
    "window",
    "new",
    "-s",
    "session:origin",
    "pr-123-review",
    "-c",
    "/path with spaces",
    "--focus=false",
    "--json",
    "--shell=none",
    "--",
    "/bin/bash",
    "--noprofile",
    "--norc",
  ]);
});

test("maps down splits to below and anchors the parent's exact block", () => {
  const { provider, calls } = fixture();
  provider.createSurface({
    name: "tests",
    cwd: "/repo",
    placement: { kind: "split", direction: "down" },
  });
  assert.deepEqual(calls[1].slice(0, 9), [
    "run",
    "-s",
    "session:origin",
    "-b",
    "block:parent",
    "--split=below",
    "--label",
    "tests",
    "-c",
  ]);
});

test("changing destination does not retarget existing children", () => {
  const { provider, calls } = fixture();
  provider.createSurface({ name: "first", cwd: "/repo" });
  provider.createSession("batch-review", "/repo");
  provider.sendKeys("block:child", "Escape");
  assert.deepEqual(calls.at(-1), [
    "send-key",
    "-s",
    "session:origin",
    "-b",
    "block:child",
    "escape",
  ]);
  assert.equal(provider.sessionId, "session:new");
  assert.throws(
    () =>
      provider.createSurface({
        name: "bad-split",
        cwd: "/repo",
        placement: { kind: "split", direction: "right" },
      }),
    /original session/,
  );
  assert.equal(provider.useOriginSession(), "session:origin");
});

test("rejects destructive actions on the parent or unrelated panes", () => {
  const { provider, calls } = fixture();
  assert.throws(() => provider.closeSurface("block:parent"), /not owned/);
  assert.throws(
    () => provider.runCommand("block:unrelated", "exit"),
    /not owned/,
  );
  assert.throws(() => provider.sendKeys("block:unrelated", "C-c"), /not owned/);
  assert.equal(calls.length, 0);
});

test("a server failure is unavailable, never evidence of pane absence", async () => {
  const { provider, disconnect } = fixture();
  provider.createSurface({ name: "review", cwd: "/repo" });
  disconnect();
  assert.equal(
    (await provider.inspectSurface("block:child")).kind,
    "unavailable",
  );
  await assert.rejects(
    provider.waitForSurfaceAbsence("block:child"),
    /absence unconfirmed/,
  );
});

test("confirms absence after closing an owned block", async () => {
  const { provider } = fixture();
  provider.createSurface({ name: "review", cwd: "/repo" });
  assert.equal((await provider.inspectSurface("block:child")).kind, "present");
  provider.closeSurface("block:child");
  await provider.waitForSurfaceAbsence("block:child");
});

test("maps structured process metadata, without scraping terminal output", async () => {
  const { provider } = fixture();
  provider.createSurface({ name: "review", cwd: "/repo" });
  const info = await provider.getProcessInfo("block:child");
  assert.deepEqual(info.pids, [10, 11]);
  assert.equal(info.foregroundProcesses[0].argv0, "pi");
  assert.equal(info.shellPid, 10);
});

test("writes a private launch script and quotes its path as shell data", () => {
  const { provider, calls } = fixture();
  const directory = mkdtempSync(join(tmpdir(), "rex-script-"));
  try {
    provider.createSurface({ name: "review", cwd: directory });
    const script = join(directory, "it's a script.sh");
    provider.runScript("block:child", "printf '%s' ready", {
      scriptPath: script,
      scriptPreamble: "# test",
    });
    assert.match(readFileSync(script, "utf8"), /export PATH=/);
    assert.deepEqual(calls.at(-1), [
      "send-key",
      "-s",
      "session:origin",
      "-b",
      "block:child",
      "enter",
    ]);
    assert.match(calls.at(-2)!.at(-1)!, /it'\\''s a script/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("rejects remote servers instead of supervising a mismatched filesystem", () => {
  const driver: RexDriver = {
    sync: () =>
      JSON.stringify({ host_id: "remote", endpoint: "tcp://remote:1234" }),
    async: async () => "",
  };
  const provider = new RexSurfaceProvider({
    session: "session:remote",
    driver,
  });
  assert.equal(provider.isAvailable(), false);
  assert.throws(
    () => provider.createSurface({ name: "review", cwd: "/repo" }),
    /local Unix-socket/,
  );
});

test("unsupported managed-worktree operations fail before creating Rex resources", () => {
  const { provider, calls } = fixture();
  assert.throws(() => provider.createWorktreeSurface(), /pass its path as cwd/);
  assert.throws(() => provider.removeWorktreeSurface(), /unsupported/);
  assert.equal(calls.length, 0);
});
