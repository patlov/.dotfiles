import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const entryType = "pi.virtual-model-state";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") {
      return {
        url: `data:text/javascript,export const VIRTUAL_MODEL_STATE_ENTRY=${JSON.stringify(entryType)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { default: initialise } =
  await import("../../../../extensions.router.ts");

function harness(probability = 0) {
  const entries = [];
  const commands = new Map();
  const events = new Map();
  const statuses = new Map();
  const notifications = [];
  let router;
  let classifications = 0;
  let waited = false;
  const ctx = {
    model: { provider: "router", id: "auto" },
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus: (key, value) => statuses.set(key, value),
      notify: (...args) => notifications.push(args),
    },
    waitForIdle: async () => {
      waited = true;
    },
    modelRegistry: {
      find: (provider, id) => ({ provider, id }),
      getAvailableOfType: async () => [{ id: "jev-latest" }],
      classify: async () => {
        classifications++;
        return {
          stopReason: "stop",
          answers: { implement: { type: "bool", probability } },
        };
      },
    },
  };
  const appendEntry = (customType, data) =>
    entries.push({ type: "custom", customType, data });
  initialise({
    registerVirtualModel: (definition) => {
      router = definition;
    },
    registerCommand: (name, definition) => commands.set(name, definition),
    on: (name, handler) => events.set(name, handler),
    appendEntry,
  });
  const state = () =>
    entries.findLast(
      (e) =>
        e.customType === entryType &&
        e.data.provider === "router" &&
        e.data.modelId === "auto",
    )?.data.state;
  return {
    ctx,
    entries,
    statuses,
    notifications,
    commands,
    events,
    appendEntry,
    state,
    get classifications() {
      return classifications;
    },
    get waited() {
      return waited;
    },
    async route(options = {}) {
      const result = await router.route(
        {
          reason: "user",
          thinkingLevel: "high",
          messages: [],
          state: state(),
          ...options,
        },
        ctx,
      );
      if (result.state && result.state !== state())
        appendEntry(entryType, {
          provider: "router",
          modelId: "auto",
          state: result.state,
        });
      return result;
    },
  };
}

const implementation = {
  provider: "router",
  modelId: "auto",
  state: { phase: "implementation" },
};

test("planning reset unlocks an existing Sol branch and next planning turn uses Opus", async () => {
  const h = harness();
  h.appendEntry(entryType, implementation);
  assert.equal((await h.route()).model.id, "gpt-6.1-sol");
  assert.equal(h.classifications, 0);
  await h.commands.get("router").handler("plan", h.ctx);
  assert.equal(h.waited, true);
  assert.deepEqual(h.state(), { phase: "planning" });
  assert.equal(h.statuses.get("router-phase"), "Router: planning (Opus)");
  assert.equal((await h.route()).model.id, "claude-opus-5-5");
  assert.equal(h.classifications, 1);
});

test("Jev approval switches once to sticky Sol", async () => {
  const h = harness(1);
  assert.equal((await h.route()).model.id, "gpt-6.1-sol");
  assert.equal((await h.route()).model.id, "gpt-6.1-sol");
  assert.equal(h.classifications, 1);
  assert.equal(h.statuses.get("router-phase"), "Router: implementation (Sol)");
  assert.equal(h.notifications.length, 1);
});

test("continuations and retries stay on their physical model without classification", async () => {
  const h = harness(1);
  const previous = {
    model: { provider: "anthropic", id: "claude-opus-5-5" },
    thinkingLevel: "medium",
  };
  const failed = {
    model: { provider: "openai-codex", id: "gpt-6.1-sol" },
    thinkingLevel: "high",
  };
  assert.deepEqual(await h.route({ reason: "continuation", previous }), {
    model: previous.model,
    thinkingLevel: "medium",
  });
  assert.deepEqual(await h.route({ reason: "retry", previous, failed }), {
    model: failed.model,
    thinkingLevel: "high",
  });
  assert.equal(h.classifications, 0);
});

test("phase indicator reconstructs branch state on reload and tree navigation", async () => {
  const h = harness();
  h.appendEntry(entryType, implementation);
  await h.events.get("session_start")({}, h.ctx);
  assert.equal(h.statuses.get("router-phase"), "Router: implementation (Sol)");
  await h.commands.get("router").handler("plan", h.ctx);
  h.appendEntry(entryType, {
    provider: "other",
    modelId: "auto",
    state: { phase: "implementation" },
  });
  await h.events.get("session_start")({}, h.ctx);
  assert.equal(h.statuses.get("router-phase"), "Router: planning (Opus)");
  h.entries.splice(1);
  await h.events.get("session_tree")({}, h.ctx);
  assert.equal(h.statuses.get("router-phase"), "Router: implementation (Sol)");
});

test("reset and indicator do not override a different selected model", async () => {
  const h = harness();
  h.ctx.model = { provider: "openai-codex", id: "gpt-6.1-sol" };
  await h.commands.get("router").handler("plan", h.ctx);
  assert.equal(h.entries.length, 0);
  await h.events.get("model_select")({}, h.ctx);
  assert.equal(h.statuses.get("router-phase"), undefined);
  assert.match(h.notifications[0][0], /Select \/model router\/auto/);
});

test("unsupported command arguments do not reset state", async () => {
  const h = harness();
  h.appendEntry(entryType, implementation);
  await h.commands.get("router").handler("build", h.ctx);
  assert.equal(h.waited, false);
  assert.equal(h.entries.length, 1);
  assert.equal(h.state().phase, "implementation");
});
