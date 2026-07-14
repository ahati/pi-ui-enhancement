import {
  type ExtensionAPI,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { getTextField, isMcpToolCandidate, toRecord } from "./tool-metadata.js";
import {
  type RenderTheme,
  formatMcpCallLine,
  renderMcpResult,
} from "./tool-overrides.js";
import { onReloadShutdown } from "./extension-lifecycle.js";
import type { ToolDisplayConfig } from "./types.js";

/**
 * MCP tool rendering broke on Pi 0.80.6+ for two reasons:
 *   1. `pi.registerTool` is now a per-extension API, so intercepting it on
 *      this extension's API no longer captures tools registered by other
 *      extensions (e.g. pi-mcp-adapter's direct tools).
 *   2. `pi.getAllTools()` returns shallow clones that omit `renderCall`,
 *      `renderResult`, and `label`, so the session-start decoration sweep
 *      mutates throwaway objects and never reaches the live tool definitions.
 *
 * `ToolExecutionComponent` resolves the renderer per call via
 * `getCallRenderer()` / `getResultRenderer()`, reading the LIVE
 * `this.toolDefinition` (which still carries `label`). Patching those
 * prototype methods lets us render MCP-candidate tools with pi-tool-display's
 * compact renderers at render time, regardless of how the tool was registered
 * or whether `getAllTools()` exposes renderers. This mirrors the existing
 * `UserMessageComponent` prototype patch.
 */

const PATCH_VERSION = 1;
const PATCH_OWNER = {};

type CallRenderer = (
  args: Record<string, unknown>,
  theme: RenderTheme,
  context?: unknown,
) => unknown;

type ResultRenderer = (
  result: { content?: unknown[]; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: RenderTheme,
  context?: unknown,
) => unknown;

interface ToolDefLike {
  name?: string;
  label?: string;
  description?: string;
  [key: string]: unknown;
}

interface PatchableToolExecutionPrototype {
  getCallRenderer: () => CallRenderer | undefined;
  getResultRenderer: () => ResultRenderer | undefined;
  __piToolDisplayOriginalGetCallRenderer?: () => CallRenderer | undefined;
  __piToolDisplayOriginalGetResultRenderer?: () => ResultRenderer | undefined;
  __piToolDisplayMcpPatchVersion?: number;
  __piToolDisplayMcpPatchOwner?: object;
  toolDefinition?: ToolDefLike;
  builtInToolDefinition?: unknown;
}

function getToolExecutionPrototype(): PatchableToolExecutionPrototype {
  return ToolExecutionComponent.prototype as unknown as PatchableToolExecutionPrototype;
}

function isMcpRenderCandidate(proto: PatchableToolExecutionPrototype): boolean {
  const def = proto.toolDefinition;
  if (!def) {
    return false;
  }
  // Built-in tools are owned by pi-tool-display's own overrides; leave them to
  // the original resolver so per-tool ownership and diff renderers still apply.
  if (proto.builtInToolDefinition) {
    return false;
  }
  return isMcpToolCandidate(def);
}

function patchToolExecutionMcpRender(
  getConfig: () => ToolDisplayConfig,
): void {
  const proto = getToolExecutionPrototype();
  if (
    typeof proto.getCallRenderer !== "function"
    || typeof proto.getResultRenderer !== "function"
  ) {
    return;
  }

  const previousCall = proto.__piToolDisplayOriginalGetCallRenderer;
  const previousResult = proto.__piToolDisplayOriginalGetResultRenderer;
  const hasPreviousPatch =
    typeof previousCall === "function" && previousCall !== proto.getCallRenderer;
  const isCurrentPatch = proto.__piToolDisplayMcpPatchOwner === PATCH_OWNER;

  // Restore a stale patch left by a previous extension instance.
  if (hasPreviousPatch && !isCurrentPatch && typeof previousCall === "function" && typeof previousResult === "function") {
    proto.getCallRenderer = previousCall;
    proto.getResultRenderer = previousResult;
    delete proto.__piToolDisplayOriginalGetCallRenderer;
    delete proto.__piToolDisplayOriginalGetResultRenderer;
    delete proto.__piToolDisplayMcpPatchVersion;
    delete proto.__piToolDisplayMcpPatchOwner;
  }

  if (
    proto.__piToolDisplayMcpPatchVersion === PATCH_VERSION
    && proto.__piToolDisplayMcpPatchOwner === PATCH_OWNER
    && typeof proto.__piToolDisplayOriginalGetCallRenderer === "function"
  ) {
    return;
  }

  if (!proto.__piToolDisplayOriginalGetCallRenderer) {
    proto.__piToolDisplayOriginalGetCallRenderer = proto.getCallRenderer;
  }
  if (!proto.__piToolDisplayOriginalGetResultRenderer) {
    proto.__piToolDisplayOriginalGetResultRenderer = proto.getResultRenderer;
  }

  const originalGetCallRenderer = proto.__piToolDisplayOriginalGetCallRenderer;
  const originalGetResultRenderer = proto.__piToolDisplayOriginalGetResultRenderer;

  proto.getCallRenderer = function (this: PatchableToolExecutionPrototype): CallRenderer | undefined {
    if (isMcpRenderCandidate(this)) {
      const def = this.toolDefinition;
      const toolName = (def && getTextField(def, "name")) ?? "mcp";
      const toolLabel =
        (def && getTextField(def, "label"))
        ?? (toolName === "mcp" ? "MCP Proxy" : `MCP ${toolName}`);
      return (args, theme) => formatMcpCallLine(toolName, toolLabel, toRecord(args), theme);
    }
    return originalGetCallRenderer?.call(this);
  };

  proto.getResultRenderer = function (this: PatchableToolExecutionPrototype): ResultRenderer | undefined {
    if (isMcpRenderCandidate(this)) {
      return (result, options, theme) =>
        renderMcpResult(result as never, options, getConfig(), theme);
    }
    return originalGetResultRenderer?.call(this);
  };

  proto.__piToolDisplayMcpPatchVersion = PATCH_VERSION;
  proto.__piToolDisplayMcpPatchOwner = PATCH_OWNER;
}

function restoreToolExecutionMcpRender(): void {
  const proto = getToolExecutionPrototype();
  const originalCall = proto.__piToolDisplayOriginalGetCallRenderer;
  const originalResult = proto.__piToolDisplayOriginalGetResultRenderer;
  if (typeof originalCall === "function") {
    proto.getCallRenderer = originalCall;
  }
  if (typeof originalResult === "function") {
    proto.getResultRenderer = originalResult;
  }
  delete proto.__piToolDisplayOriginalGetCallRenderer;
  delete proto.__piToolDisplayOriginalGetResultRenderer;
  delete proto.__piToolDisplayMcpPatchVersion;
  delete proto.__piToolDisplayMcpPatchOwner;
}

export default function registerToolExecutionMcpPatch(
  pi: ExtensionAPI,
  getConfig: () => ToolDisplayConfig,
): void {
  patchToolExecutionMcpRender(getConfig);

  onReloadShutdown(pi, () => {
    restoreToolExecutionMcpRender();
  });

  pi.on("before_agent_start", async () => {
    patchToolExecutionMcpRender(getConfig);
  });

  pi.on("session_start", async () => {
    patchToolExecutionMcpRender(getConfig);
  });
}