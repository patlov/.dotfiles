import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRexMigration, selectBackend } from "../backend.ts";

test("selects Rex only when not nested inside Herdr", () => {
  assert.equal(selectBackend({ REX_SESSION: "session:local" }), "rex");
  assert.equal(
    selectBackend({
      REX_SESSION: "session:outer",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    }),
    "herdr",
  );
  assert.equal(selectBackend({}), "herdr");
});

test("accepts explicit nested-terminal overrides and rejects misspellings", () => {
  assert.equal(
    selectBackend({
      PI_TERMINAL_BACKEND: "rex",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    }),
    "rex",
  );
  assert.equal(
    selectBackend({
      PI_TERMINAL_BACKEND: "herdr",
      REX_SESSION: "session:outer",
    }),
    "herdr",
  );
  assert.throws(
    () => selectBackend({ PI_TERMINAL_BACKEND: "tmux" }),
    /must be rex or herdr/,
  );
});

test("requires a restart rather than replacing an already-owned backend", () => {
  assert.throws(() => assertRexMigration(false, true), /Restart Pi once/);
  assertRexMigration(false, false);
  assertRexMigration(true, true);
});
