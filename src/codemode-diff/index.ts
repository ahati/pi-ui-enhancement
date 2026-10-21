import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Capture } from "./capture.js";
import { asRecord, DETAILS_KEY, type Change } from "./changes.js";

/** Structural event shapes; field names are stable across supported Pi versions. */
interface ToolExecutionStartEvent {
  toolCallId?: unknown;
  toolName?: unknown;
  parentToolCallId?: unknown;
}

interface ToolResultEvent {
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
  input?: unknown;
  details?: unknown;
}

interface ToolExecutionEndEvent extends ToolResultEvent {}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The edit tool supplies a display diff in its result details. */
function editChangeFromResult(event: ToolResultEvent): Change | undefined {
  const input = asRecord(event.input);
  const path = asString(input?.path) ?? asString(input?.file_path);
  if (!path) return undefined;
  const details = asRecord(event.details);
  const change: Change = {
    toolCallId: asString(event.toolCallId) ?? "",
    tool: "edit",
    path,
    kind: "edit",
    ...(typeof details?.diff === "string"
      ? { diff: details.diff }
      : { note: "The edit tool did not provide a display diff." }),
  };
  return change;
}

/**
 * Wires the codemode diff capture to Pi's execution events. Ported from
 * hyein-cbio/pi-codemode-diff (src/index.ts); rendering is integrated into
 * this extension's codemode display instead of a separate renderer.
 */
export function registerCodemodeDiffCapture(pi: ExtensionAPI, capture: Capture): void {
  pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
    capture.start(
      asString(event.toolCallId) ?? "",
      asString(event.toolName) ?? "",
      asString(event.parentToolCallId),
    );
  });

  pi.on("tool_result", (event: ToolResultEvent) => {
    const toolCallId = asString(event.toolCallId);
    if (toolCallId && capture.isNested(toolCallId)) {
      if (event.isError !== true && asString(event.toolName) === "edit") {
        const change = editChangeFromResult(event);
        if (change) capture.add(change);
      }
      if (event.isError === true) capture.reportError(toolCallId);
    }

    // Persist the captured changes in the codemode result's rendering metadata
    // so resumed sessions can render them too. Only `details` changes here:
    // script values, content, usage, structuredContent, tool success/failure
    // and the model's context are left to the host.
    if (asString(event.toolName) !== "codemode") return undefined;
    const rootId = asString(event.toolCallId);
    if (!rootId) return undefined;
    const details = capture.details(rootId);
    if (!details) return undefined;
    return { details: { ...asRecord(event.details), [DETAILS_KEY]: details } };
  });

  pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
    // This event carries the final outcome after every tool_result handler.
    // A later extension may reject a write whose mutation we already observed.
    const toolCallId = asString(event.toolCallId);
    if (event.isError === true && toolCallId && capture.isNested(toolCallId)) {
      capture.reportError(toolCallId);
    }
    if (toolCallId) capture.end(toolCallId);
  });

  const clear = (): void => capture.clear();
  pi.on("session_start", clear);
  pi.on("session_shutdown", clear);
  pi.on("agent_end", clear);
}

export { Capture };
