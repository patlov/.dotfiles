import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { createServer } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";
import { pcm16ToWav, rmsFromPcm16 } from "./audio.ts";

const MODEL_PATH = process.env.PI_DICTATE_MODEL ??
  join(homedir(), ".local", "share", "pi-local-dictate", "models", "ggml-large-v3-turbo-q5_0.bin");
const SERVER_COMMAND = process.env.PI_DICTATE_SERVER ?? "whisper-server";
const REC_COMMAND = process.env.PI_DICTATE_REC ?? "rec";
const LANGUAGE = process.env.PI_DICTATE_LANGUAGE ?? "en";
const SERVER_IDLE_MS = 30 * 60 * 1_000;
const SERVER_START_TIMEOUT_MS = 90_000;
const INFERENCE_TIMEOUT_MS = 120_000;
const METER_CELLS = 6;
const METER_TICK_MS = 60;
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
const PEAK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEBUG = process.env.DICTATE_DEBUG === "1";
const DEBUG_LOG = join(tmpdir(), "dictate-debug.log");

function debug(message: string): void {
  if (!DEBUG) return;
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Debug logging must never interfere with dictation.
  }
}

type DictationState = "idle" | "recording" | "finalizing";
type Recorder = ChildProcessByStdio<null, Readable, Readable>;
type EditorLike = { getText(): string; setText(text: string): void };
type Target =
  | { kind: "editor"; editor: EditorLike }
  | { kind: "typable"; component: { handleInput(data: string): void } };

function asEditorLike(value: unknown): EditorLike | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EditorLike>;
  return typeof candidate.getText === "function" && typeof candidate.setText === "function"
    ? candidate as EditorLike
    : null;
}

function rmsToBlock(rms: number): string {
  if (rms <= 0) return PEAK_BLOCKS[0]!;
  const db = 20 * Math.log10(rms);
  const normalized = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB)));
  return PEAK_BLOCKS[Math.floor(normalized * (PEAK_BLOCKS.length - 1))]!;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export default function localDictateExtension(pi: ExtensionAPI): void {
  let state: DictationState = "idle";
  let activeCtx: ExtensionContext | null = null;
  let lastCtx: ExtensionContext | null = null;
  let recorder: Recorder | null = null;
  let audioChunks: Buffer[] = [];
  let cancelled = false;
  let generation = 0;
  let meterTimer: NodeJS.Timeout | null = null;
  let spinnerTimer: NodeJS.Timeout | null = null;
  let currentLevel = 0;
  let meter = new Array<number>(METER_CELLS).fill(0);
  let tuiHandle: any = null;
  let removeInputListener: (() => void) | null = null;
  let inferenceAbort: AbortController | null = null;

  let serverProcess: ChildProcess | null = null;
  let serverPort: number | null = null;
  let serverReady: Promise<void> | null = null;
  let serverIdleTimer: NodeJS.Timeout | null = null;
  let serverErrorTail = "";

  const setStatus = (message: string | undefined) => activeCtx?.ui.setStatus("local-dictate", message);

  const stopAnimations = () => {
    if (meterTimer) clearInterval(meterTimer);
    if (spinnerTimer) clearInterval(spinnerTimer);
    meterTimer = null;
    spinnerTimer = null;
  };

  const renderMeter = () => {
    const dot = activeCtx?.ui.theme.fg("error", "●") ?? "●";
    const loading = serverReady ? " · model loading" : "";
    setStatus(`${dot} ${meter.map(rmsToBlock).join("")} listening…${loading}`);
  };

  const startMeter = () => {
    stopAnimations();
    meter = new Array<number>(METER_CELLS).fill(0);
    currentLevel = 0;
    renderMeter();
    meterTimer = setInterval(() => {
      meter.shift();
      meter.push(currentLevel);
      renderMeter();
    }, METER_TICK_MS);
  };

  const startSpinner = (message: string) => {
    stopAnimations();
    let frame = 0;
    setStatus(`${SPINNER_FRAMES[frame]} ${message}`);
    spinnerTimer = setInterval(() => {
      frame = (frame + 1) % SPINNER_FRAMES.length;
      setStatus(`${SPINNER_FRAMES[frame]} ${message}`);
    }, 80);
  };

  const resolveTarget = (): Target | null => {
    const focused = tuiHandle?.focusedComponent;
    if (!focused) return null;
    const editor = asEditorLike(focused) ?? asEditorLike(focused.editor);
    if (editor) return { kind: "editor", editor };
    if (typeof focused.handleInput === "function") return { kind: "typable", component: focused };
    return null;
  };

  const deliver = (text: string, ctx: ExtensionContext) => {
    const target = resolveTarget();
    if (target?.kind === "editor") {
      const current = target.editor.getText() ?? "";
      target.editor.setText(current + (current && !/\s$/.test(current) ? " " : "") + text);
      tuiHandle.requestRender?.();
      return;
    }
    if (target?.kind === "typable") {
      target.component.handleInput(text);
      tuiHandle.requestRender?.();
      return;
    }

    const current = ctx.ui.getEditorText() ?? "";
    ctx.ui.setEditorText(current + (current && !/\s$/.test(current) ? " " : "") + text);
    ctx.ui.notify("No focused input was visible; transcript was appended to the main editor", "warning");
  };

  const clearIdleTimer = () => {
    if (serverIdleTimer) clearTimeout(serverIdleTimer);
    serverIdleTimer = null;
  };

  const stopServer = () => {
    clearIdleTimer();
    serverReady = null;
    serverPort = null;
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
    }
    serverProcess = null;
    serverErrorTail = "";
  };

  const scheduleServerStop = () => {
    clearIdleTimer();
    if (!serverProcess || serverProcess.exitCode !== null) return;
    serverIdleTimer = setTimeout(() => {
      if (state === "idle") stopServer();
      else scheduleServerStop();
    }, SERVER_IDLE_MS);
  };

  const waitForServer = async (port: number, child: ChildProcess): Promise<void> => {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || (child.pid === undefined && serverErrorTail)) {
        throw new Error(`whisper-server exited during startup${serverErrorTail ? `: ${serverErrorTail.trim()}` : ""}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return;
      } catch {
        // The local socket is expected to reject connections while the model loads.
      }
      await delay(250);
    }
    throw new Error("Timed out while loading the local Whisper model");
  };

  const ensureServer = (): Promise<void> => {
    clearIdleTimer();
    if (serverProcess && serverProcess.exitCode === null && serverPort && !serverReady) {
      return Promise.resolve();
    }
    if (serverReady) return serverReady;
    if (!existsSync(MODEL_PATH)) {
      return Promise.reject(new Error(`Whisper model not found: ${MODEL_PATH}`));
    }

    serverReady = (async () => {
      const port = await availablePort();
      serverPort = port;
      serverErrorTail = "";
      const child = spawn(SERVER_COMMAND, [
        "--host", "127.0.0.1",
        "--port", String(port),
        "--model", MODEL_PATH,
        "--language", LANGUAGE,
        "--no-timestamps",
        "--suppress-nst",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      serverProcess = child;
      child.stderr?.on("data", (chunk: Buffer) => {
        serverErrorTail = (serverErrorTail + chunk.toString()).slice(-2_000);
      });
      child.on("error", (error) => {
        serverErrorTail = (serverErrorTail + error.message).slice(-2_000);
      });
      await waitForServer(port, child);
      serverReady = null;
      if (state === "recording") renderMeter();
    })().catch((error) => {
      stopServer();
      throw error;
    });
    serverReady.catch(() => {});
    return serverReady;
  };

  const waitForRecorderClose = async (proc: Recorder): Promise<void> => {
    if (proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1_000);
      proc.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  const transcribe = async (wav: Buffer): Promise<string> => {
    const controller = new AbortController();
    inferenceAbort = controller;
    const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
    try {
      await ensureServer();
      controller.signal.throwIfAborted();
      if (!serverPort) throw new Error("Local Whisper server is unavailable");
      if (state === "finalizing") startSpinner("transcribing…");

      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "dictation.wav");
      form.append("response_format", "json");
      form.append("temperature", "0.0");
      form.append("temperature_inc", "0.2");
      form.append("no_timestamps", "true");
      form.append("suppress_non_speech", "true");
      form.append("language", LANGUAGE);
      const response = await fetch(`http://127.0.0.1:${serverPort}/inference`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Whisper inference failed (${response.status}): ${await response.text()}`);
      const result = await response.json() as { text?: unknown; error?: unknown };
      if (typeof result.error === "string") throw new Error(result.error);
      if (typeof result.text !== "string") throw new Error("Whisper returned no transcript");
      return normalizeTranscript(result.text);
    } finally {
      clearTimeout(timeout);
      if (inferenceAbort === controller) inferenceAbort = null;
    }
  };

  const resetDictation = () => {
    generation += 1;
    debug(`reset -> generation ${generation}`);
    stopAnimations();
    recorder = null;
    audioChunks = [];
    cancelled = false;
    state = "idle";
    setStatus(undefined);
    activeCtx = null;
    scheduleServerStop();
  };

  const cancelDictation = () => {
    if (state === "idle") return;
    cancelled = true;
    inferenceAbort?.abort();
    recorder?.kill("SIGTERM");
    resetDictation();
  };

  const finalizeDictation = async (myGeneration: number, ctx: ExtensionContext, proc: Recorder) => {
    state = "finalizing";
    startSpinner(serverReady ? "loading model…" : "transcribing…");
    proc.kill("SIGTERM");
    await waitForRecorderClose(proc);
    if (myGeneration !== generation || cancelled) return;

    try {
      const wav = pcm16ToWav(audioChunks);
      if (wav.length <= 44) throw new Error("No microphone audio was captured");
      const text = await transcribe(wav);
      if (myGeneration !== generation || cancelled) return;
      if (text) deliver(text, ctx);
      else ctx.ui.notify("No speech was detected", "warning");
    } catch (error) {
      if (!cancelled && myGeneration === generation) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      if (myGeneration === generation) resetDictation();
    }
  };

  const startDictation = (ctx: ExtensionContext) => {
    if (!existsSync(MODEL_PATH)) {
      ctx.ui.notify(`Local Whisper model not found: ${MODEL_PATH}`, "error");
      return;
    }
    activeCtx = ctx;
    audioChunks = [];
    cancelled = false;
    state = "recording";
    const myGeneration = ++generation;
    debug(`start generation=${myGeneration}`);
    startMeter();
    void ensureServer().catch(() => {});

    const proc = spawn(REC_COMMAND, [
      "-q", "--buffer", "512",
      "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer",
      "-t", "raw", "-",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    recorder = proc;
    proc.stdout.on("data", (chunk: Buffer) => {
      if (myGeneration !== generation) return;
      audioChunks.push(Buffer.from(chunk));
      currentLevel = rmsFromPcm16(chunk);
    });
    proc.on("error", (error) => {
      if (myGeneration !== generation) return;
      ctx.ui.notify(`Could not start microphone capture: ${error.message}`, "error");
      resetDictation();
    });
    proc.on("exit", (code, signal) => {
      if (myGeneration !== generation || state !== "recording") return;
      ctx.ui.notify(`Microphone capture stopped unexpectedly (${signal ?? code ?? "unknown"})`, "error");
      resetDictation();
    });
  };

  const toggleDictation = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    debug(`toggle state=${state}`);
    if (state === "idle") {
      if (tuiHandle && !resolveTarget()) {
        ctx.ui.notify("No input field is focused — dictation not started", "warning");
        return;
      }
      startDictation(ctx);
      return;
    }
    if (state === "recording" && recorder) {
      void finalizeDictation(generation, ctx, recorder);
    }
  };

  const onGlobalInput = (data: string) => {
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
    debug(`input data=${JSON.stringify(data)}`);

    if (matchesKey(data, Key.ctrl("space"))) {
      debug(`toggle-key data=${JSON.stringify(data)} state=${state}`);
      if (lastCtx) toggleDictation(lastCtx);
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrlShift("space"))) {
      debug(`cancel-key data=${JSON.stringify(data)} state=${state}`);
      cancelDictation();
      return { consume: true };
    }
    return undefined;
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    debug(`session_start mode=${ctx.mode}`);
    if (ctx.mode !== "tui" || tuiHandle) return;
    ctx.ui.setWidget("local-dictate-tui-handle", (tui: any) => {
      tuiHandle = tui;
      removeInputListener = tui.addInputListener(onGlobalInput);
      debug("global input listener installed");
      return { render: () => [], invalidate: () => {} };
    });
  });

  pi.registerShortcut(Key.ctrl("space"), {
    description: "Toggle local voice dictation",
    handler: async (ctx) => toggleDictation(ctx),
  });
  pi.registerShortcut(Key.ctrlShift("space"), {
    description: "Cancel local voice dictation",
    handler: async () => cancelDictation(),
  });

  pi.on("session_shutdown", () => {
    generation += 1;
    cancelled = true;
    state = "idle";
    inferenceAbort?.abort();
    recorder?.kill("SIGTERM");
    stopAnimations();
    setStatus(undefined);
    activeCtx = null;
    audioChunks = [];
    stopServer();
    removeInputListener?.();
    removeInputListener = null;
  });
}
