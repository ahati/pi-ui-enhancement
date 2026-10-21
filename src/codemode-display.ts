import { keyHint, ToolExecutionComponent, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component } from "@earendil-works/pi-tui";
import { registerCleanup } from "./disposable.js";
import type { Capture } from "./codemode-diff/capture.js";
import { readChanges } from "./codemode-diff/changes.js";
import { diffSection } from "./codemode-diff/section.js";
import { isRecord } from "./tool-metadata.js";
import { compactOutputLines, extractTextOutput, pluralize, previewLines, sanitizeAnsiForThemedOutput, splitLines } from "./render-utils.js";
import type { ToolDisplayConfig } from "./types.js";

type CallRenderer = NonNullable<ToolDefinition["renderCall"]>;
type ResultRenderer = NonNullable<ToolDefinition["renderResult"]>;

interface CodemodeDisplayHost {
  getAllTools(): readonly { name: string; sourceInfo: { path: string } }[];
  on(event: "session_start" | "session_shutdown", handler: () => void): void;
}

interface ToolRendererLookup {
  toolName: string;
  getCallRenderer(): CallRenderer | undefined;
  getResultRenderer(): ResultRenderer | undefined;
}

interface CallCounts {
  running: number;
  ok: number;
  error: number;
  cancelled: number;
}

function renderSummary(
  counts: CallCounts,
  options: Parameters<ResultRenderer>[1],
  theme: Parameters<ResultRenderer>[2],
  isError: boolean,
): Text {
  const total = counts.running + counts.ok + counts.error + counts.cancelled;
  const status = options.isPartial ? "running" : isError ? "failed" : "completed";
  const summary = [status, `${total} ${total === 1 ? "call" : "calls"}`];
  if (counts.error) summary.push(`${counts.error} failed`);
  if (counts.cancelled) summary.push(`${counts.cancelled} cancelled`);
  const color = isError || counts.error ? "error" : "muted";
  return new Text(
    theme.fg(color, `↳ ${summary.join(" · ")}`) + " • " + keyHint("app.tools.expand", "to expand"),
    0, 0,
  );
}

const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;

function renderOutputPreview(
  result: Parameters<ResultRenderer>[0],
  limit: number,
  theme: Parameters<ResultRenderer>[2],
  isError: boolean,
): Component {
  const [first, ...rest] = result.content;
  const content = first?.type === "text" && SCRIPT_HEADER.test(first.text) ? rest : result.content;
  const lines = compactOutputLines(splitLines(extractTextOutput({ content })), { expanded: false });
  const color = isError ? "error" : "toolOutput";
  const text = lines.map((line) => theme.fg(color, sanitizeAnsiForThemedOutput(line))).join("\n");
  const output = new Text(text, 0, 0);
  return {
    render(width) {
      if (!text) return [];
      // Wrap before limiting so one-line JSON respects previewLines.
      const { shown, remaining } = previewLines(output.render(width), limit);
      if (remaining > 0) {
        const hint = theme.fg("muted", `... (${remaining} more ${pluralize(remaining, "line")})`);
        shown.push(...new Text(hint, 0, 0).render(width));
      }
      return ["", ...shown];
    },
    invalidate() { output.invalidate(); },
  };
}

function renderCodemodeResult(
  original: NonNullable<ResultRenderer>,
  result: Parameters<ResultRenderer>[0],
  options: Parameters<ResultRenderer>[1],
  theme: Parameters<ResultRenderer>[2],
  context: Parameters<ResultRenderer>[3],
  getConfig: () => Pick<ToolDisplayConfig, "codemodeOutputMode" | "previewLines" | "codemodeShowFileDiffs">,
  capture?: Capture,
): Component {
  // Our collapsed Container cannot be reused as the native renderer's Text component.
  const nativeContext = { ...context, lastComponent: undefined };
  if (options.expanded) return original(result, options, theme, nativeContext);
  const expanded = false;
  const counts = { running: 0, ok: 0, error: 0, cancelled: 0 };
  const details: unknown = result.details;
  if (details !== undefined) {
    if (!isRecord(details) || !Array.isArray(details.calls)) {
      throw new Error("Invalid codemode call details");
    }
    for (const call of details.calls) {
      const status: unknown = isRecord(call) ? call.status : undefined;
      switch (status) {
        case "running":
        case "ok":
        case "error":
        case "cancelled":
          counts[status]++;
          break;
        default:
          throw new Error("Invalid codemode call status");
      }
    }
  }
  const summary = renderSummary(counts, options, theme, context.isError);
  const config = getConfig();

  // File-change diffs captured inside the codemode run (pi-codemode-diff
  // feature): live from the capture during the run, persisted in details
  // for resumed sessions.
  const toolCallId = typeof context.toolCallId === "string" ? context.toolCallId : "";
  if (typeof context.invalidate === "function" && toolCallId) {
    capture?.watch(toolCallId, context.invalidate);
  }
  const changes = config.codemodeShowFileDiffs
    ? readChanges(result.details) ?? (toolCallId ? capture?.changes(toolCallId) : undefined)
    : undefined;

  if (config.codemodeOutputMode === "summary") {
    if (!changes?.length) return summary;
    const summaryWithDiffs = new Container();
    summaryWithDiffs.addChild(summary);
    summaryWithDiffs.addChild(diffSection(changes, expanded, theme));
    return summaryWithDiffs;
  }
  const container = new Container();
  container.addChild(summary);
  container.addChild(original({ ...result, content: [] }, options, theme, nativeContext));
  if (changes?.length) {
    container.addChild(diffSection(changes, expanded, theme));
  }
  if (config.codemodeOutputMode === "preview" && !options.isPartial) {
    container.addChild(renderOutputPreview(result, config.previewLines, theme, context.isError));
  }
  return container;
}

type CodemodeRenderConfig = Pick<ToolDisplayConfig, "codemodeOutputMode" | "previewLines" | "codemodeShowFileDiffs">;

/** Pi >= 1.0.1 exposes the official render-time renderer chain. */
interface ToolRendererChainHost {
  registerToolRenderer?: (
    resolver: (toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined,
  ) => void;
}

interface ToolRenderers {
  renderCall?: CallRenderer;
  renderResult?: ResultRenderer;
}

function wrapCodemodeCallRenderer(original: NonNullable<CallRenderer>): CallRenderer {
  return (args, theme, context) => {
    if (context?.expanded) return original(args, theme, context);
    return new Text(theme.fg("toolTitle", theme.bold("codemode")), 0, 0);
  };
}

export function registerCodemodeDisplay(
  pi: CodemodeDisplayHost,
  getConfig: () => Pick<ToolDisplayConfig, "codemodeOutputMode" | "previewLines" | "codemodeShowFileDiffs">,
  capture?: Capture,
): void {
  let nativeCodemode = false;

  pi.on("session_start", () => {
    nativeCodemode = pi.getAllTools().some(
      (tool) => tool.name === "codemode" && tool.sourceInfo.path === "builtin:codemode",
    );
  });

  // Preferred path on Pi >= 1.0.1: the official renderer chain.
  const chainHost = pi as unknown as ToolRendererChainHost;
  if (typeof chainHost.registerToolRenderer === "function") {
    chainHost.registerToolRenderer((toolName, next) => {
      const base = next();
      if (!nativeCodemode || toolName !== "codemode" || !base?.renderResult) return base;
      const renderBase = base.renderResult;
      return {
        ...base,
        ...(base.renderCall ? { renderCall: wrapCodemodeCallRenderer(base.renderCall) } : {}),
        renderResult(result, options, theme, context) {
          return renderCodemodeResult(
            renderBase, result, options, theme, context, getConfig, capture,
          );
        },
      };
    });
    return;
  }

  // Fallback for Pi 0.8x: prototype patch using private TUI lookups.
  const rawPrototype: unknown = ToolExecutionComponent.prototype;
  // SAFETY: Pi's ToolExecutionComponent implements these private getters and stores toolName on each instance.
  const prototype = rawPrototype as ToolRendererLookup;
  const originalCall = prototype.getCallRenderer;
  const originalResult = prototype.getResultRenderer;

  const getCallRenderer: ToolRendererLookup["getCallRenderer"] = function (this: ToolRendererLookup) {
    const original = originalCall.call(this);
    if (!nativeCodemode || this.toolName !== "codemode" || !original) return original;
    return wrapCodemodeCallRenderer(original);
  };

  const getResultRenderer: ToolRendererLookup["getResultRenderer"] = function (this: ToolRendererLookup) {
    const original = originalResult.call(this);
    if (!nativeCodemode || this.toolName !== "codemode" || !original) return original;
    return (result, options, theme, context) =>
      renderCodemodeResult(original, result, options, theme, context, getConfig, capture);
  };

  prototype.getCallRenderer = getCallRenderer;
  prototype.getResultRenderer = getResultRenderer;

  const restore = () => {
    nativeCodemode = false;
    if (prototype.getCallRenderer === getCallRenderer) prototype.getCallRenderer = originalCall;
    if (prototype.getResultRenderer === getResultRenderer) prototype.getResultRenderer = originalResult;
  };
  registerCleanup(restore);
  pi.on("session_shutdown", restore);
}
