import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGitInterceptor } from "./git-interceptor.ts";
import { registerSecretCloak } from "./secret-cloak.ts";

export default function safetyExtension(pi: ExtensionAPI): void {
  registerGitInterceptor(pi);
  registerSecretCloak(pi);
}
