import type {
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { normalizeCustomToolOverrideEntry } from "../config-store.js";
import {
	countNonEmptyLines,
	extractTextOutput,
	pluralize,
} from "../render-utils.js";
import { getTextField, toRecord } from "../tool-metadata.js";
import {
	BUILT_IN_TOOL_OVERRIDE_NAMES,
	CUSTOM_TOOL_OVERRIDE_WILDCARD,
	type CustomToolOverrideConfig,
	type ToolDisplayConfig,
} from "../types.js";
import {
	formatArgCountSuffix,
	formatExpandHint,
	formatRtkSummarySuffix,
	formatSearchSummary,
	handlePartialResult,
	prepareOutputLines,
	renderMcpPreview,
	renderSearchPreview,
	textResult,
} from "./formatting.js";
import type {
	McpPreviewHintContext,
	PreviewHintContext,
	RenderTheme,
	ToolRenderInput,
} from "./types.js";

export function resolveMcpProxyCallTarget(args: Record<string, unknown>): string {
	const tool = getTextField(args, "tool");
	const connect = getTextField(args, "connect");
	const describe = getTextField(args, "describe");
	const search = getTextField(args, "search");
	const server = getTextField(args, "server");

	if (tool) {
		return server ? `call ${server}:${tool}` : `call ${tool}`;
	}
	if (connect) {
		return `connect ${connect}`;
	}
	if (describe) {
		return server ? `describe ${describe} @${server}` : `describe ${describe}`;
	}
	if (search) {
		return server ? `search "${search}" @${server}` : `search "${search}"`;
	}
	if (server) {
		return `tools ${server}`;
	}
	return "status";
}

export function formatMcpCallLine(
	toolName: string,
	toolLabel: string,
	args: Record<string, unknown>,
	theme: RenderTheme,
): Text {
	const argCount = Object.keys(args).length;
	const argSuffix = formatArgCountSuffix(argCount, theme);
	const target =
		toolName === "mcp"
			? resolveMcpProxyCallTarget(args)
			: toolLabel.startsWith("MCP ")
				? toolLabel.slice("MCP ".length)
				: toolLabel;

	return new Text(
		`${theme.fg("toolTitle", theme.bold("MCP"))} ${theme.fg("accent", target)}${argSuffix}`,
		0,
		0,
	);
}

export function getMcpTruncationDetails(details: unknown): {
	truncated: boolean;
	fullOutputPath?: string;
} {
	const detailRecord = toRecord(details);
	const truncation = toRecord(detailRecord.truncation);

	const fullOutputPath =
		typeof truncation.fullOutputPath === "string"
			? truncation.fullOutputPath
			: typeof detailRecord.fullOutputPath === "string"
				? detailRecord.fullOutputPath
				: undefined;

	return {
		truncated: truncation.truncated === true,
		fullOutputPath,
	};
}

export function renderMcpResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text {
	const partial = handlePartialResult(options, theme, "running...");
	if (partial) {
		return partial;
	}

	if (config.mcpOutputMode === "hidden") {
		return textResult("");
	}

	const lines = prepareOutputLines(extractTextOutput(result), options);
	const truncation = getMcpTruncationDetails(result.details);
	const mcpCtx: McpPreviewHintContext = { lines, config, theme, options, details: result.details, truncation };

	if (config.mcpOutputMode === "summary") {
		if (options.expanded) {
			return renderMcpPreview(mcpCtx, true);
		}

		const lineCount = countNonEmptyLines(lines);
		let summary = theme.fg(
			"muted",
			`↳ ${lineCount} ${pluralize(lineCount, "line")} returned`,
		);
		summary += formatExpandHint(theme);
		if (config.showTruncationHints && truncation.truncated) {
			summary += theme.fg("warning", " • truncated");
		}
		summary += formatRtkSummarySuffix({ details: result.details, config, theme });
		return textResult(summary);
	}

	return renderMcpPreview(mcpCtx);
}

export function renderSearchResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	unitLabel: string,
	details: GrepToolDetails | FindToolDetails | LsToolDetails | undefined,
	pluralLabel?: string,
): Text {
	if (options.isPartial) {
		return handlePartialResult(options, theme, "running...") ?? textResult("");
	}

	const lines = prepareOutputLines(extractTextOutput(result), options);

	if (config.searchOutputMode === "hidden") {
		return textResult("");
	}

	const hintCtx: PreviewHintContext = { lines, config, theme, options, details };

	if (config.searchOutputMode === "count") {
		if (options.expanded) {
			return renderSearchPreview(hintCtx, true);
		}

		let summary = formatSearchSummary(
			lines,
			unitLabel,
			details,
			theme,
			config.showTruncationHints,
			pluralLabel,
		);
		summary += formatExpandHint(theme);
		summary += formatRtkSummarySuffix({ details, config, theme });
		return textResult(summary);
	}

	return renderSearchPreview(hintCtx);
}

export function isBuiltInToolName(toolName: string): boolean {
	return (BUILT_IN_TOOL_OVERRIDE_NAMES as readonly string[]).includes(toolName);
}

/** The exact-name entry for a tool, if configured (no wildcard fallback). */
export function getExactCustomToolOverride(
	toolName: string,
	config: ToolDisplayConfig,
): CustomToolOverrideConfig | undefined {
	if (!toolName || isBuiltInToolName(toolName)) {
		return undefined;
	}

	const overrides = toRecord((config as unknown as Record<string, unknown>).customToolOverrides);
	const exact = overrides[toolName];
	return exact === undefined ? undefined : normalizeCustomToolOverrideEntry(exact);
}

export function getWildcardCustomToolOverride(
	config: ToolDisplayConfig,
): CustomToolOverrideConfig | undefined {
	const overrides = toRecord((config as unknown as Record<string, unknown>).customToolOverrides);
	const wildcard = overrides[CUSTOM_TOOL_OVERRIDE_WILDCARD];
	return wildcard === undefined ? undefined : normalizeCustomToolOverrideEntry(wildcard);
}

/**
 * Exact-name entries win; the "*" wildcard covers every other tool so all
 * calls are decorated by default. An exact entry with enabled:false opts a
 * tool back out.
 */
export function getRuntimeCustomToolOverride(
	toolName: string,
	config: ToolDisplayConfig,
): CustomToolOverrideConfig | undefined {
	return getExactCustomToolOverride(toolName, config) ?? getWildcardCustomToolOverride(config);
}

export function renderCustomToolResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	outputMode: CustomToolOverrideConfig["outputMode"],
	theme: RenderTheme,
): Text {
	return renderMcpResult(
		result as ToolRenderInput,
		options,
		{ ...config, mcpOutputMode: outputMode },
		theme,
	);
}
