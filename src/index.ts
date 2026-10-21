import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createToolDisplayConfigController } from "./config-controller.js";
import { registerToolDisplayOverrides } from "./tool-overrides.js";
import { buildBashIntentSystemPrompt } from "./bash-intent.js";
import { registerCodemodeDisplay } from "./codemode-display.js";
import { disposeAll, resetDisposed } from "./disposable.js";
import { configureToolDisplayDebugLogger } from "./debug-logger.js";
import { registerThinkingLabeling } from "./thinking-label.js";
import registerNativeUserMessageBox from "./user-message-box-native.js";
import registerToolExecutionMcpPatch from "./tool-execution-patch.js";
import { registerShikiCodeBlockRenderer } from "./shiki-codeblock-renderer.js";

export default function toolDisplayExtension(pi: ExtensionAPI): void {
  // Pi normally calls session_shutdown before reload, but dispose a prior
  // generation defensively when loaders invoke this entrypoint twice.
  disposeAll();
  resetDisposed();

  const configController = createToolDisplayConfigController(pi);
  // Renderers are gated on `enabled`, but the /tool-display command always
  // registers so the extension can be re-enabled from the UI without editing
  // config.json by hand (maplezzk's global switch).
  const enabled = configController.getConfig().enabled;

  configureToolDisplayDebugLogger(configController.getDebugRuntimeConfig);

  pi.on("session_shutdown", (event: { reason: string }) => {
    if (event.reason === "reload") {
      disposeAll();
    }
  });

  // Refresh config from the session context before the lifecycle handlers below
  // register deferred tool overrides, so a trusted project config's ownership
  // and output modes apply in the same session_start pass.
  pi.on("session_start", async (_event, ctx) => {
    configController.refreshFromContext(ctx);
    for (const warning of configController.consumePendingLoadWarnings()) {
      ctx.ui?.notify?.(warning, "warning");
    }
  });

  if (enabled) {
    registerToolDisplayOverrides(pi, configController.getEffectiveConfig);
    registerCodemodeDisplay(pi, configController.getConfig);
    registerNativeUserMessageBox(pi, configController.getConfig);
    registerThinkingLabeling(pi);
    registerToolExecutionMcpPatch(pi, configController.getEffectiveConfig);
    registerShikiCodeBlockRenderer(configController.getConfig);
  }

  pi.registerCommand("tool-display", {
    description: "Configure tool output rendering (OpenCode-style)",
    handler: async (args, ctx) => {
      const { runToolDisplayCommandHandler } = await import("./config-modal.js");
      await runToolDisplayCommandHandler(args, ctx, configController);
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    configController.refreshCapabilitiesFromContext(ctx);

    // Opt-in: teach the intent-comment convention so the model supplies it
    // without the user having to ask.
    const systemPrompt = buildBashIntentSystemPrompt(
      event.systemPrompt,
      configController.getEffectiveConfig(),
    );
    if (systemPrompt === undefined) {
      return;
    }

    return { systemPrompt };
  });
}
