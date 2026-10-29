import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type {
  CreateSurfaceOptions,
  SurfaceInfo,
  SurfaceProcessInfo,
  SurfaceProvider,
} from "pi-herdr-agents/maestro/core/surface-provider.ts";
import type { PaneInspection } from "pi-herdr-agents/maestro/core/types.ts";

const execute = promisify(execFile);
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export interface RexDriver {
  sync(args: string[]): string;
  async(args: string[], timeoutMs?: number): Promise<string>;
}

export function createRexDriver(server?: string): RexDriver {
  const prefix = ["--autostart=false", ...(server ? ["-S", server] : [])];
  return {
    sync: (args) =>
      execFileSync("rex", [...prefix, ...args], {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    async: async (args, timeoutMs = 10_000) =>
      (
        await execute("rex", [...prefix, ...args], {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
  };
}

interface RexProcess {
  pid: number;
  name: string;
  argv0?: string;
  cwd?: string;
}
interface RexProcesses {
  child?: RexProcess;
  foreground?: RexProcess;
  ancestors?: RexProcess[];
  last_exit: { exit_code: number } | null;
}
interface RexBlock {
  block_id: string;
  window_id?: string;
  label?: string;
  host_id: string;
}
interface CreatedWindow {
  block_ids: string[];
  window_id: string;
}

export class RexSurfaceProvider implements SurfaceProvider {
  readonly name = "rex";
  readonly #driver: RexDriver;
  readonly #surfaces = new Map<string, { session: string; window: string }>();
  readonly #originSession: string;
  readonly #originBlock?: string;
  #session: string;
  #hostId?: string;

  constructor(options: { session: string; block?: string; driver: RexDriver }) {
    this.#session = this.#originSession = options.session;
    this.#originBlock = options.block;
    this.#driver = options.driver;
  }

  get sessionId(): string {
    return this.#session;
  }

  #identity(): { host_id: string; endpoint: string } {
    const identity = JSON.parse(this.#driver.sync(["whoami", "--json"]));
    if (!identity.host_id || !identity.endpoint?.startsWith("unix://")) {
      throw new Error(
        "Rex subagents require a local Unix-socket server; remote files and processes are not supervised by this host.",
      );
    }
    this.#hostId = identity.host_id;
    return identity;
  }

  isAvailable(): boolean {
    try {
      this.#identity();
      return true;
    } catch {
      return false;
    }
  }

  setupHint(): string {
    return "Start Pi inside a local Rex terminal, or select the Herdr backend inside Herdr.";
  }

  selectSession(session: string): string {
    const { sessions } = JSON.parse(this.#driver.sync(["ls", "--json"]));
    if (
      !sessions.some(
        (row: { session_id: string }) => row.session_id === session,
      )
    ) {
      throw new Error(
        `Rex session not found: ${session}. Use the full session ID from rex ls --json.`,
      );
    }
    this.#session = session;
    return session;
  }

  useOriginSession(): string {
    return this.selectSession(this.#originSession);
  }

  createSession(label: string, cwd: string): string {
    if (!label.trim() || label.startsWith("-"))
      throw new Error(
        "Choose a nonempty Rex session label that does not start with a dash.",
      );
    this.#identity();
    const result = JSON.parse(
      this.#driver.sync([
        "new",
        label,
        "-c",
        cwd,
        "--window",
        "Overview",
        "--json",
      ]),
    );
    if (
      typeof result.session_id !== "string" ||
      !result.session_id.startsWith("session:")
    ) {
      throw new Error(
        "Rex did not return a session ID. Inspect rex ls before retrying; the session may have been created.",
      );
    }
    this.#session = result.session_id;
    return this.#session;
  }

  createSurface(options: CreateSurfaceOptions): string {
    if (!options.name.trim() || options.name.startsWith("-"))
      throw new Error(
        "Choose a nonempty subagent name that does not start with a dash.",
      );
    this.#identity();
    const placement = options.placement;
    const split = placement?.kind === "split";
    if (
      split &&
      (this.#session !== this.#originSession || !this.#originBlock)
    ) {
      throw new Error(
        "Rex split placement requires the original session and pane. Use tab placement for a separate agents session.",
      );
    }
    const args = split
      ? [
          "run",
          "-s",
          this.#session,
          "-b",
          this.#originBlock!,
          `--split=${placement?.kind === "split" && placement.direction === "down" ? "below" : "right"}`,
          "--label",
          options.name,
        ]
      : ["window", "new", "-s", this.#session, options.name];
    const result: CreatedWindow = JSON.parse(
      this.#driver.sync([
        ...args,
        "-c",
        options.cwd,
        "--focus=false",
        "--json",
        "--shell=none",
        "--",
        "/bin/bash",
        "--noprofile",
        "--norc",
      ]),
    );
    const id = result.block_ids?.[0];
    if (!id?.startsWith("block:") || !result.window_id) {
      throw new Error(
        "Rex did not return block/window IDs. Inspect the session before retrying; a pane may already exist.",
      );
    }
    this.#surfaces.set(id, {
      session: this.#session,
      window: result.window_id,
    });
    return id;
  }

  #owned(id: string): { session: string; window: string } {
    const surface = this.#surfaces.get(id);
    if (!surface || id === this.#originBlock)
      throw new Error(`Rex block is not owned by this subagent host: ${id}`);
    return surface;
  }

  runCommand(id: string, command: string): void {
    const { session } = this.#owned(id);
    this.#driver.sync(["send", "-s", session, "-b", id, "--", command]);
    this.#driver.sync(["send-key", "-s", session, "-b", id, "enter"]);
  }

  runScript(
    id: string,
    command: string,
    options: { scriptPath: string; scriptPreamble: string },
  ): string {
    this.#owned(id);
    mkdirSync(dirname(options.scriptPath), { recursive: true });
    writeFileSync(
      options.scriptPath,
      [
        "#!/bin/bash",
        options.scriptPreamble,
        `export PATH=${quote(process.env.PATH ?? "/usr/bin:/bin")}`,
        command,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    this.runCommand(id, `bash ${quote(options.scriptPath)}`);
    return options.scriptPath;
  }

  async readScreen(id: string, lines = 50): Promise<string> {
    const { session } = this.#owned(id);
    const output = await this.#driver.async([
      "capture",
      "-s",
      session,
      "-b",
      id,
      "--trim",
      "--unwrap",
    ]);
    return output.split("\n").slice(-lines).join("\n");
  }

  closeSurface(id: string): void {
    const { session } = this.#owned(id);
    this.#driver.sync(["block", "close", "-s", session, id]);
  }

  async listSurfaces(options?: { timeoutMs?: number }): Promise<SurfaceInfo[]> {
    const deadline = Date.now() + (options?.timeoutMs ?? 10_000);
    const remaining = () => {
      const duration = deadline - Date.now();
      if (duration <= 0) throw new Error("Rex surface inspection timed out");
      return duration;
    };
    const { sessions } = JSON.parse(
      await this.#driver.async(["ls", "--json"], remaining()),
    );
    const present = new Set(
      sessions.map((row: { session_id: string }) => row.session_id),
    );
    const targets = [
      ...new Set([...this.#surfaces.values()].map((row) => row.session)),
    ].filter((id) => present.has(id));
    const snapshots = await Promise.all(
      targets.map(async (session) => {
        const { blocks } = JSON.parse(
          await this.#driver.async(
            ["block", "ls", "-s", session, "--json"],
            remaining(),
          ),
        );
        return (blocks as RexBlock[])
          .filter(
            (block) =>
              this.#surfaces.has(block.block_id) &&
              block.host_id === this.#hostId,
          )
          .map((block) => ({
            id: block.block_id,
            name: block.label,
            group: block.window_id,
            workspaceId: session,
          }));
      }),
    );
    return snapshots.flat();
  }

  async inspectSurface(id: string): Promise<PaneInspection> {
    try {
      return (await this.listSurfaces()).some((row) => row.id === id)
        ? { kind: "present", agentStatus: "unknown", observedAt: Date.now() }
        : { kind: "missing" };
    } catch (error) {
      return {
        kind: "unavailable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  attachSurface(id: string) {
    this.#owned(id);
    return {
      id,
      runCommand: (command: string) => this.runCommand(id, command),
      readScreen: (lines?: number) => this.readScreen(id, lines),
      sendKeys: (keys: string) => this.sendKeys(id, keys),
      close: () => this.closeSurface(id),
    };
  }

  sendKeys(id: string, keys: string): void {
    const { session } = this.#owned(id);
    const key =
      (
        { Escape: "escape", Enter: "enter", "C-c": "ctrl+c" } as Record<
          string,
          string
        >
      )[keys] ?? keys;
    this.#driver.sync(["send-key", "-s", session, "-b", id, key]);
  }

  async getProcessInfo(
    id: string,
    options?: { timeoutMs?: number },
  ): Promise<SurfaceProcessInfo> {
    const { session } = this.#owned(id);
    const info: RexProcesses = JSON.parse(
      await this.#driver.async(
        ["block", "call", "-s", session, "-b", id, "process"],
        options?.timeoutMs,
      ),
    );
    const processes = [
      info.child,
      info.foreground,
      ...(info.ancestors ?? []),
    ].filter((row): row is RexProcess => !!row);
    return {
      shellPid: info.child?.pid,
      foregroundProcessGroupId: info.foreground?.pid,
      pids: [...new Set(processes.map((row) => row.pid))],
      foregroundProcesses: info.foreground ? [info.foreground] : [],
    };
  }

  async waitForShellReady(
    id: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    const deadline = Date.now() + (options?.timeoutMs ?? 10_000);
    do {
      const info = await this.getProcessInfo(id, {
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      if (info.foregroundProcesses.some((row) => row.name === "bash")) return;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(
      `Rex shell readiness unconfirmed for ${id}; no command was sent.`,
    );
  }

  async waitForSurfaceAbsence(
    id: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    let present: boolean;
    try {
      present = (await this.listSurfaces(options)).some(
        (surface) => surface.id === id,
      );
    } catch (error) {
      throw new Error(
        `Rex block absence unconfirmed: ${id} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (present) throw new Error(`Rex block absence unconfirmed: ${id}`);
  }

  createWorktreeSurface(): never {
    throw new Error(
      "Rex does not yet support the host-managed worktree parameter. Prepare an isolated Git worktree with the worktree-review helper and pass its path as cwd; lifecycle and cancellation remain supervised.",
    );
  }
  removeWorktreeSurface(): never {
    throw new Error(
      "Rex host-managed worktree removal is unsupported; use the review helper for review worktrees.",
    );
  }
  async listWorktreeSurfaces() {
    return [];
  }
  reportOpenedPrimaryWorkspace() {
    return undefined;
  }
  focusWorkspace(): never {
    throw new Error(
      "Rex worktree handoff is unsupported; use a review worktree as cwd.",
    );
  }
  setTitle(): void {}
}
