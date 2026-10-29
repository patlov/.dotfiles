import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiRunSessionInfrastructure } from "pi-herdr-agents/maestro/runtime/pi-run-session.ts";
import { createRexDriver, RexSurfaceProvider } from "./rex-surface.ts";
import { assertRexMigration, selectBackend } from "./backend.ts";

const STATE = Symbol.for("patlov/pi-terminal-agents/rex-v1");
interface RexState {
  provider: RexSurfaceProvider;
  infrastructure: PiRunSessionInfrastructure;
}
const globals = globalThis as typeof globalThis & { [STATE]?: RexState };

export default async function terminalAgents(pi: ExtensionAPI) {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const require = createRequire(join(agentDir, "npm", "package.json"));
  const root = dirname(require.resolve("pi-herdr-agents/package.json"));
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const load = (relative: string) =>
    import(pathToFileURL(join(root, relative)).href);
  const host: {
    default: (
      api: ExtensionAPI,
      options?: { infrastructure: PiRunSessionInfrastructure },
    ) => void;
  } = await load("pi-extension/subagents/index.ts");
  if (selectBackend(process.env) === "herdr") {
    host.default(pi);
    return;
  }
  if (version !== "3.3.1") {
    throw new Error(
      `pi-terminal-agents supports pi-herdr-agents 3.3.1, found ${version}. Validate the Rex adapter against the new host before enabling it.`,
    );
  }
  if (!process.env.REX_SESSION)
    throw new Error("Start Pi inside Rex before selecting the Rex backend.");
  const previous = (
    globalThis as Record<symbol, { session?: unknown } | undefined>
  )[Symbol.for("pi-subagents/runtime")];
  assertRexMigration(!!globals[STATE], !!previous?.session);
  const { launchOperationsFromSurface } = await load(
    "maestro/adapters/pi/launch.ts",
  );
  const { loadPaneConfig } = await load("maestro/core/config/pane-config.ts");
  const config = loadPaneConfig(
    join(agentDir, "herdr-agents"),
    join(root, "config.json.example"),
  );
  if (!globals[STATE]) {
    const provider = new RexSurfaceProvider({
      session: process.env.REX_SESSION,
      block: process.env.REX_BLOCK,
      driver: createRexDriver(process.env.REX_SERVER),
    });
    const { SupervisionCoordinator } = await load(
      "maestro/core/supervision.ts",
    );
    const { loadSupervisionConfig } = await load(
      "maestro/core/config/supervision-config.ts",
    );
    const supervisionConfig = loadSupervisionConfig(
      join(agentDir, "herdr-agents"),
      join(root, "config.json.example"),
    );
    const supervision = new SupervisionCoordinator(
      async () => {
        try {
          return {
            complete: true,
            panes: (await provider.listSurfaces()).map((row) => ({
              paneId: row.id,
              workspaceId: row.workspaceId ?? "",
            })),
          };
        } catch {
          return { complete: false, panes: [] };
        }
      },
      (id: string) => provider.inspectSurface(id),
      supervisionConfig.forcePolling,
    );
    globals[STATE] = {
      provider,
      infrastructure: {
        surfaceProvider: provider,
        launchOperations: launchOperationsFromSurface(provider, {
          ...config,
          mode: config.mode === "split" ? "split" : "tab",
        }),
        supervision,
      },
    };
  }
  const { provider, infrastructure } = globals[STATE]!;
  infrastructure.launchOperations = launchOperationsFromSurface(provider, {
    ...config,
    mode: config.mode === "split" ? "split" : "tab",
  });
  const wrapped: ExtensionAPI = {
    ...pi,
    registerTool(tool) {
      if (tool.name === "worktree_list" || tool.name === "worktree_remove")
        return;
      const definition = { ...tool };
      if (tool.name === "subagent") {
        definition.description = tool.description.replace(
          "Spawn a sub-agent in a dedicated terminal herdr pane, or in an isolated Herdr-managed Git worktree when worktree is provided.",
          "Spawn a supervised Pi subagent in a Rex tab (or configured split). For isolated reviews, prepare the worktree with the review helper and pass cwd. The managed worktree parameter is unsupported on Rex.",
        );
      } else if (tool.name === "subagent_resume") {
        definition.description = tool.description.replace(
          "in a new herdr pane",
          "in a new Rex tab",
        );
      }
      pi.registerTool(definition);
    },
    registerCommand(name, command) {
      if (name !== "worktree") pi.registerCommand(name, command);
    },
  };
  host.default(wrapped, { infrastructure });

  pi.on("session_shutdown", (event) => {
    if (!["reload", "new", "resume", "fork"].includes(event.reason ?? "quit"))
      delete globals[STATE];
  });
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("terminal-agents", "Subagents: Rex");
  });
  if (!process.env.PI_SUBAGENT_ID) {
    pi.registerTool({
      name: "rex_agents_session",
      label: "Rex agents session",
      description:
        "Choose the Rex session for future subagents without moving existing runs or stealing focus. Create one session per review batch, select a full session ID, or restore this Pi terminal's original session. Existing runs remain supervised in their original tabs. This does not launch a reviewer.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("new"),
          Type.Literal("select"),
          Type.Literal("here"),
        ]),
        label: Type.Optional(
          Type.String({
            description: "Name for a new session, e.g. asklio-pr-reviews",
          }),
        ),
        sessionId: Type.Optional(
          Type.String({ description: "Full Rex session ID for select" }),
        ),
      }),
      async execute(_id, params, _signal, _update, ctx) {
        let sessionId: string;
        if (params.action === "new") {
          if (!params.label?.trim())
            throw new Error("Provide a label for the new Rex session.");
          sessionId = provider.createSession(params.label, ctx.cwd);
        } else if (params.action === "select") {
          if (!params.sessionId)
            throw new Error("Provide the full Rex sessionId to select.");
          sessionId = provider.selectSession(params.sessionId);
        } else sessionId = provider.useOriginSession();
        return {
          content: [
            {
              type: "text",
              text: `Future Rex subagents will open in ${sessionId}. Existing runs are unchanged.`,
            },
          ],
          details: { backend: "rex", sessionId },
        };
      },
    });
    pi.registerCommand("rex-agents", {
      description:
        "Rex subagent destination: /rex-agents, /rex-agents new LABEL, /rex-agents here, or /rex-agents select SESSION_ID",
      async handler(args, ctx) {
        const text = args.trim();
        try {
          if (text === "here") provider.useOriginSession();
          else if (text.startsWith("new "))
            provider.createSession(text.slice(4).trim(), ctx.cwd);
          else if (text.startsWith("select "))
            provider.selectSession(text.slice(7).trim());
          else if (text)
            throw new Error(
              "Usage: /rex-agents [new LABEL | here | select SESSION_ID]",
            );
          ctx.ui.notify(
            `Rex subagents destination: ${provider.sessionId}`,
            "info",
          );
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
    });
  }
}
