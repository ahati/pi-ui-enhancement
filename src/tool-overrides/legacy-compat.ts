import type {
	EditToolDetails,
	ExtensionAPI,
	ReadToolDetails,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { logToolDisplayDebug } from "../debug-logger.js";
import { renderEditDiffResult } from "../diff-renderer.js";
import { buildPendingEditPreviewData } from "../pending-diff-preview.js";
import {
	compactOutputLines,
	extractTextOutput,
	shortenPath,
	splitLines,
} from "../render-utils.js";
import { getTextField, isMcpToolCandidate, toRecord } from "../tool-metadata.js";
import type { ToolDisplayConfig } from "../types.js";
import {
	formatExpandHint,
	formatInProgressLineCount,
	formatLineCountSuffix,
	formatReadSummary,
	formatRtkSummarySuffix,
	getEditLineCount,
	getNumericField,
	getStringField,
	isToolError,
	linkToolPath,
	partialResultText,
	prepareOutputLines,
	renderSearchPreview,
	textResult,
} from "./formatting.js";
import { formatMcpCallLine, renderMcpResult } from "./mcp-custom-renderers.js";
import {
	EDIT_PENDING_PREVIEW_STATE_KEY,
	TOOL_DISPLAY_DECORATED_PROPERTIES,
	type ConfigGetter,
	type PreviewHintContext,
	type RenderTheme,
	type RuntimeToolDefinition,
	type ToolDisplayAdapter,
	type ToolDisplayApi,
	type ToolDisplayKind,
	type ToolPropertyDescriptorSnapshot,
	type ToolRenderContextLike,
	type ToolRenderInput,
} from "./types.js";
import {
	buildPendingDiffCallComponent,
	resolvePendingDiffPreview,
} from "./write-meta.js";

export const decoratedToolDescriptors = new WeakMap<RuntimeToolDefinition, ToolPropertyDescriptorSnapshot>();
export const decoratedTools = new Set<RuntimeToolDefinition>();

export function captureToolPropertyDescriptors(
	tool: RuntimeToolDefinition,
	descriptorSnapshots: WeakMap<RuntimeToolDefinition, ToolPropertyDescriptorSnapshot>,
	decoratedTools: Set<RuntimeToolDefinition>,
): void {
	if (descriptorSnapshots.has(tool)) {
		return;
	}

	const snapshot: ToolPropertyDescriptorSnapshot = {};
	for (const property of TOOL_DISPLAY_DECORATED_PROPERTIES) {
		const descriptor = Object.getOwnPropertyDescriptor(tool, property);
		if (descriptor) {
			snapshot[property] = descriptor;
		}
	}
	descriptorSnapshots.set(tool, snapshot);
	decoratedTools.add(tool);
}

export function restoreToolPropertyDescriptors(
	descriptorSnapshots: WeakMap<RuntimeToolDefinition, ToolPropertyDescriptorSnapshot>,
	decoratedTools: Set<RuntimeToolDefinition>,
): void {
	for (const tool of decoratedTools) {
		const snapshot = descriptorSnapshots.get(tool) ?? {};
		for (const property of TOOL_DISPLAY_DECORATED_PROPERTIES) {
			const descriptor = snapshot[property];
			if (descriptor) {
				Object.defineProperty(tool, property, descriptor);
			} else {
				delete tool[property];
			}
		}
		descriptorSnapshots.delete(tool);
	}
	decoratedTools.clear();
}

export function getAdapterKind(tool: RuntimeToolDefinition, adapter: ToolDisplayAdapter): ToolDisplayKind {
	if (adapter.kind) {
		return adapter.kind;
	}
	if (tool.name === "read" || tool.name === "edit") {
		return tool.name;
	}
	return isMcpToolCandidate(tool) ? "mcp" : "generic";
}

export function getAdapterPath(args: unknown, adapter: ToolDisplayAdapter): string | undefined {
	const explicitPath = adapter.getPath?.(args);
	if (explicitPath) {
		return explicitPath;
	}

	for (const field of adapter.pathFields ?? ["file_path", "path"]) {
		const value = getStringField(args, field);
		if (value) {
			return value;
		}
	}

	return undefined;
}

export function renderReadDisplayCall(
	args: unknown,
	theme: RenderTheme,
	adapter: ToolDisplayAdapter = {},
): Text {
	const rawPath = getAdapterPath(args, adapter);
	const path = shortenPath(rawPath);
	const offset = getNumericField(args, "offset");
	const limit = getNumericField(args, "limit");
	let suffix = "";
	if (offset !== undefined || limit !== undefined) {
		const from = offset ?? 1;
		const to = limit !== undefined ? from + limit - 1 : undefined;
		suffix = to ? `:${from}-${to}` : `:${from}`;
	}
	const line = `${theme.fg("toolTitle", theme.bold("read"))} ${linkToolPath(rawPath, theme.fg("accent", path || "..."))}${theme.fg("warning", suffix)}`;
	return textResult(line);
}

export function renderReadDisplayResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text {
	if (options.isPartial) {
		return partialResultText(theme, "reading...");
	}

	if (config.readOutputMode === "hidden") {
		return textResult("");
	}

	const details = result.details as ReadToolDetails | undefined;
	const rawOutput = extractTextOutput(result);
	const lines = prepareOutputLines(rawOutput, options);
	const hintCtx: PreviewHintContext = { lines, config, theme, options, details };

	if (config.readOutputMode === "summary") {
		if (options.expanded) {
			return renderSearchPreview(hintCtx, true);
		}

		const summaryLines = compactOutputLines(splitLines(rawOutput), {
			expanded: true,
		});
		let summary = formatReadSummary(
			summaryLines,
			details,
			theme,
			config.showTruncationHints,
		);
		summary += formatExpandHint(theme);
		summary += formatRtkSummarySuffix({ details: result.details, config, theme });
		return textResult(summary);
	}

	return renderSearchPreview(hintCtx);
}

export function renderEditDisplayCall(
	args: unknown,
	theme: RenderTheme,
	context: ToolRenderContextLike | undefined,
	adapter: ToolDisplayAdapter = {},
	getConfig: ConfigGetter,
): Text | Container {
	const rawPath = getAdapterPath(args, adapter);
	const path = shortenPath(rawPath);
	const lineCount = adapter.getEditLineCount?.(args) ?? getEditLineCount(args);
	const summaryText = `${theme.fg("toolTitle", theme.bold("edit"))} ${linkToolPath(rawPath, theme.fg("accent", path || "..."))}${formatLineCountSuffix(lineCount, theme)}`;
	if (!context?.argsComplete || !context.isPartial) {
		return textResult(summaryText);
	}

	const config = getConfig();
	const previewKey = JSON.stringify({
		path: getAdapterPath(args, adapter) ?? null,
		edits: toRecord(args).edits ?? null,
		oldText: getStringField(args, "oldText") ?? null,
		newText: getStringField(args, "newText") ?? null,
	});
	const previewData = resolvePendingDiffPreview(
		context,
		EDIT_PENDING_PREVIEW_STATE_KEY,
		previewKey,
		() => buildPendingEditPreviewData(args, context?.cwd ?? process.cwd(), { allowExternalDiffPreviews: config.allowExternalDiffPreviews }),
	);
	return buildPendingDiffCallComponent(summaryText, previewData, context, config, theme);
}

export function handleEditOrWriteResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	context: ToolRenderContextLike | undefined,
	theme: RenderTheme,
	lineCount: number,
	progressLabel: string,
	errorMessage: string,
): { fallbackText: string; earlyResult: Text | undefined } {
	if (options.isPartial) {
		return { fallbackText: "", earlyResult: new Text(formatInProgressLineCount(progressLabel, lineCount, theme), 0, 0) };
	}
	const fallbackText = extractTextOutput(result);
	if (isToolError(result, context)) {
		return { fallbackText, earlyResult: textResult(theme.fg("error", fallbackText || errorMessage)) };
	}
	return { fallbackText, earlyResult: undefined };
}

export function renderEditDisplayResult(
	result: ToolRenderInput & { isError?: boolean },
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	context: ToolRenderContextLike | undefined,
	adapter: ToolDisplayAdapter = {},
	getConfig: ConfigGetter,
): unknown {
	const lineCount = adapter.getEditLineCount?.(context?.args) ?? getEditLineCount(context?.args);
	const { fallbackText, earlyResult } = handleEditOrWriteResult(result, options, context, theme, lineCount, "editing", "Edit failed.");
	if (earlyResult) {
		return earlyResult;
	}

	const config = getConfig();
	const details = result.details as EditToolDetails | undefined;
	return renderEditDiffResult(
		details,
		{ expanded: options.expanded, filePath: getAdapterPath(context?.args, adapter) },
		config,
		theme,
		fallbackText,
	);
}

export function applyToolDisplayDecorationInPlace(
	tool: RuntimeToolDefinition,
	api: ToolDisplayApi,
	adapter?: ToolDisplayAdapter,
): boolean {
	try {
		captureToolPropertyDescriptors(tool, decoratedToolDescriptors, decoratedTools);
		Object.assign(tool, api.decorateTool(tool, adapter));
		return true;
	} catch (error) {
		logToolDisplayDebug("Tool display decoration failed.", error);
		return false;
	}
}

export function installToolDisplayApi(getConfig: ConfigGetter): ToolDisplayApi {
	const adapters = new Map<string, ToolDisplayAdapter>();
	let nextAdapterId = 0;

	const resolveAdapter = (tool: RuntimeToolDefinition, adapter?: ToolDisplayAdapter): ToolDisplayAdapter => {
		if (adapter) {
			return adapter;
		}
		const toolName = getTextField(tool, "name");
		if (toolName) {
			return adapters.get(toolName) ?? {};
		}
		return {};
	};

	const api: ToolDisplayApi = {
		version: 1,
		decorateTool<T extends RuntimeToolDefinition>(tool: T, adapter?: ToolDisplayAdapter): T {
			const resolvedAdapter = resolveAdapter(tool, adapter);
			const kind = getAdapterKind(tool, resolvedAdapter);
			const overrideExisting = resolvedAdapter.overrideExistingRenderers === true;
			const preserveCallRenderer = resolvedAdapter.preserveCallRenderer === true;
			const decorated: RuntimeToolDefinition = { ...tool };

			if (!preserveCallRenderer) {
				if (resolvedAdapter.renderCall && (overrideExisting || typeof decorated.renderCall !== "function")) {
					decorated.renderCall = resolvedAdapter.renderCall;
				} else if (kind === "read" && (overrideExisting || typeof decorated.renderCall !== "function")) {
					decorated.renderCall = (args: unknown, theme: RenderTheme) => renderReadDisplayCall(args, theme, resolvedAdapter);
				} else if (kind === "edit" && (overrideExisting || typeof decorated.renderCall !== "function")) {
					decorated.renderCall = (args: unknown, theme: RenderTheme, context?: ToolRenderContextLike) => renderEditDisplayCall(args, theme, context, resolvedAdapter, getConfig);
				} else if (kind === "mcp" && (overrideExisting || typeof decorated.renderCall !== "function")) {
					decorated.renderCall = (args: unknown, theme: RenderTheme) => {
						const toolName = getTextField(decorated, "name") ?? "mcp";
						const toolLabel = getTextField(decorated, "label") ?? (toolName === "mcp" ? "MCP Proxy" : `MCP ${toolName}`);
						return formatMcpCallLine(toolName, toolLabel, toRecord(args), theme);
					};
				}
			}

			if (resolvedAdapter.renderResult && (overrideExisting || typeof decorated.renderResult !== "function")) {
				decorated.renderResult = resolvedAdapter.renderResult;
			} else if (kind === "read" && (overrideExisting || typeof decorated.renderResult !== "function")) {
				decorated.renderResult = (result: ToolRenderInput, options: ToolRenderResultOptions, theme: RenderTheme) =>
					renderReadDisplayResult(result, options, getConfig(), theme);
			} else if (kind === "edit" && (overrideExisting || typeof decorated.renderResult !== "function")) {
				decorated.renderResult = (result: ToolRenderInput & { isError?: boolean }, options: ToolRenderResultOptions, theme: RenderTheme, context?: ToolRenderContextLike) =>
					renderEditDisplayResult(result, options, theme, context, resolvedAdapter, getConfig);
			} else if (kind === "mcp" && (overrideExisting || typeof decorated.renderResult !== "function")) {
				decorated.renderResult = (result: ToolRenderInput, options: ToolRenderResultOptions, theme: RenderTheme) =>
					renderMcpResult(result, options, getConfig(), theme);
			}

			if (kind === "edit" && (overrideExisting || typeof decorated.renderShell !== "string")) {
				decorated.renderShell = "default";
			}

			return decorated as T;
		},
		registerAdapter(adapter: ToolDisplayAdapter): string {
			const id = adapter.id || adapter.toolName || `adapter-${++nextAdapterId}`;
			adapters.set(id, { ...adapter, id });
			if (adapter.toolName) {
				adapters.set(adapter.toolName, { ...adapter, id });
			}
			return id;
		},
		unregisterAdapter(id: string): boolean {
			const adapter = adapters.get(id);
			const removed = adapters.delete(id);
			if (adapter?.toolName) {
				adapters.delete(adapter.toolName);
			}
			return removed;
		},
	};

	return api;
}

export function tryGetAllTools(pi: ExtensionAPI, debugMessage: string): unknown[] | undefined {
	try {
		return pi.getAllTools();
	} catch (error) {
		logToolDisplayDebug(debugMessage, error);
		return undefined;
	}
}
