import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import terminalAgents from "../../index.ts";

export default async function hostSmoke(pi: ExtensionAPI) {
  const tools = new Map<
    string,
    (
      params: unknown,
      ctx: ExtensionContext,
    ) => Promise<AgentToolResult<unknown>>
  >();
  const names =
    process.env.PI_REX_TEST_COUNT === "2"
      ? ["rex-smoke-test", "rex-smoke-test-2"]
      : ["rex-smoke-test"];
  let delivered = 0;
  let context: ExtensionContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (type: string, data: unknown) =>
    process.stdout.write(`${JSON.stringify({ type, data })}\n`);
  await terminalAgents({
    ...pi,
    registerTool(tool) {
      tools.set(tool.name, async (params, ctx) =>
        tool.execute(
          `test-${tool.name}`,
          params as never,
          new AbortController().signal,
          undefined,
          {
            ...ctx,
            tools: [],
            executeTool: async () => {
              throw new Error("Nested test invocation is unsupported");
            },
          },
        ),
      );
      pi.registerTool(tool);
    },
    sendMessage(message, options) {
      if (message.customType === "subagent_result") {
        emit("rex_test_result", message);
        if (++delivered === names.length) {
          clearTimeout(timer);
          context?.shutdown();
        }
      } else pi.sendMessage(message, options);
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    const invoke = (name: string, params: unknown) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Test tool not registered: ${name}`);
      return tool(params, ctx);
    };
    timer = setTimeout(async () => {
      emit("rex_test_timeout", "Host did not deliver a result");
      try {
        for (const name of names) await invoke("subagent_cancel", { name });
      } finally {
        ctx.shutdown();
      }
    }, 90_000);
    try {
      const target = await invoke("rex_agents_session", {
        action: "new",
        label: "pi-rex-host-test",
      });
      emit("rex_test_session", target.details);
      const started = await Promise.all(
        names.map((name) =>
          invoke("subagent", {
            name,
            model: "openai-codex/gpt-6.1-sol",
            thinking: "low",
            fork: false,
            tools: "read",
            task: "This is a terminal integration smoke test. Do not use tools, inspect files, or launch agents. Reply with exactly REX_HOST_OK.",
          }),
        ),
      );
      emit("rex_test_started", started);
      await invoke("rex_agents_session", { action: "here" });
      if (process.env.PI_REX_TEST_CANCEL === "1") {
        emit(
          "rex_test_cancel",
          await invoke("subagent_cancel", { name: "rex-smoke-test" }),
        );
      }
    } catch (error) {
      clearTimeout(timer);
      emit(
        "rex_test_error",
        error instanceof Error ? error.message : String(error),
      );
      ctx.shutdown();
    }
  });
}
