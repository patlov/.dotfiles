export function selectBackend(env: NodeJS.ProcessEnv): "rex" | "herdr" {
  const explicit = env.PI_TERMINAL_BACKEND;
  if (explicit && explicit !== "rex" && explicit !== "herdr") {
    throw new Error("PI_TERMINAL_BACKEND must be rex or herdr.");
  }
  if (explicit === "rex" || explicit === "herdr") return explicit;
  return env.REX_SESSION && !env.HERDR_SOCKET_PATH ? "rex" : "herdr";
}

export function assertRexMigration(
  wrapperAlreadyLoaded: boolean,
  previousSessionExists: boolean,
): void {
  if (!wrapperAlreadyLoaded && previousSessionExists) {
    throw new Error(
      "Restart Pi once to switch the existing subagent host to Rex. Reload preserves the previous backend and its owned children; it cannot replace it safely. Resume this conversation in the new Pi process if needed.",
    );
  }
}
