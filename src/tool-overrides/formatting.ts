import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	formatSize,
	type BashToolDetails,
	type ReadToolDetails,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as PiTui from "@earendil-works/pi-tui";
import {
	compactOutputLines,
	countNonEmptyLines,
	isLikelyQuietCommand,
	pluralize,
	previewLines,
	sanitizeAnsiForThemedOutput,
	shortenPath,
	splitLines,
} from "../render-utils.js";
import { toRecord } from "../tool-metadata.js";
import type { ToolDisplayConfig } from "../types.js";
import {
	RTK_COMPACTION_LABEL,
	type McpPreviewHintContext,
	type PreviewHintContext,
	type RenderTheme,
	type RtkCompactionInfo,
	type RtkHintParams,
	type ToolRenderContextLike,
} from "./types.js";

export function formatExpandHint(theme: RenderTheme): string {
	return theme.fg("muted", " • Ctrl+O to expand");
}

export function formatTruncationHint(remaining: number, expanded: boolean, theme: RenderTheme): string {
	if (remaining <= 0) {
		return "";
	}
	const hint = expanded ? "" : " • Ctrl+O to expand";
	return `\n${theme.fg("muted", `... (${remaining} more ${pluralize(remaining, "line")}${hint})`)}`;
}

export function buildPreviewText(
	lines: string[],
	maxLines: number,
	theme: RenderTheme,
	expanded: boolean,
): string {
	if (lines.length === 0) {
		return theme.fg("muted", "↳ (no output)");
	}

	const { shown, remaining } = previewLines(lines, maxLines);
	let text = shown
		.map((line) => theme.fg("toolOutput", sanitizeAnsiForThemedOutput(line)))
		.join("\n");
	text += formatTruncationHint(remaining, expanded, theme);
	return text;
}

export function prepareOutputLines(
	rawText: string,
	options: ToolRenderResultOptions,
): string[] {
	return compactOutputLines(splitLines(rawText), {
		expanded: options.expanded,
		maxCollapsedConsecutiveEmptyLines: 1,
	});
}

export function formatBashNoOutputLine(
	command: string | undefined,
	theme: RenderTheme,
): string {
	if (isLikelyQuietCommand(command)) {
		return theme.fg("muted", "↳ command completed (no output)");
	}
	return theme.fg("muted", "↳ (no output)");
}

export function truncationHint(
	details: { truncation?: { truncated?: boolean } } | undefined,
): string {
	return details?.truncation?.truncated ? " • truncated" : "";
}

export function countTextLines(value: unknown): number {
	if (typeof value !== "string") {
		return 0;
	}
	return splitLines(value).length;
}

export function getStringField(value: unknown, field: string): string | undefined {
	const raw = toRecord(value)[field];
	return typeof raw === "string" ? raw : undefined;
}

export function getNumericField(value: unknown, field: string): number | undefined {
	const raw = toRecord(value)[field];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function getToolPathArg(value: unknown): string | undefined {
	return getStringField(value, "file_path") ?? getStringField(value, "path");
}

export function linkToolPath(rawPath: string | undefined, styledPath: string, cwd?: string): string {
	const caps = PiTui.getCapabilities?.();
	const hyperlinkFn = PiTui.hyperlink;
	if (!rawPath || typeof hyperlinkFn !== "function" || !caps?.hyperlinks) {
		return styledPath;
	}
	try {
		return hyperlinkFn(styledPath, pathToFileURL(resolve(cwd ?? process.cwd(), rawPath)).href);
	} catch {
		return styledPath;
	}
}

export function getToolContentArg(value: unknown): string | undefined {
	return getStringField(value, "content");
}

export function getEditPayloadLineCount(value: unknown): number {
	const record = toRecord(value);
	const lines = record.lines;
	if (Array.isArray(lines)) {
		return lines.filter((line): line is string => typeof line === "string").length;
	}
	if (typeof lines === "string") {
		return countTextLines(lines);
	}

	return countTextLines(record.newText);
}

export function getEditLineCount(value: unknown): number {
	const record = toRecord(value);
	const edits = Array.isArray(record.edits) ? record.edits as unknown[] : [];
	if (edits.length > 0) {
		return edits.reduce<number>((total, edit) => {
			return total + getEditPayloadLineCount(edit);
		}, 0);
	}

	return getEditPayloadLineCount(record);
}

export function isToolError(
	result: unknown,
	context?: ToolRenderContextLike,
): boolean {
	return context?.isError === true || toRecord(result).isError === true;
}

export function formatLineCountSuffix(
	lineCount: number,
	theme: RenderTheme,
): string {
	return theme.fg("muted", ` (${lineCount} ${pluralize(lineCount, "line")})`);
}

export function formatWriteCallSuffix(
	lineCount: number,
	sizeBytes: number,
	theme: RenderTheme,
): string {
	return theme.fg(
		"muted",
		` (${lineCount} ${pluralize(lineCount, "line")} • ${formatSize(sizeBytes)})`,
	);
}

export function formatInProgressLineCount(
	action: string,
	lineCount: number,
	theme: RenderTheme,
): string {
	return theme.fg("warning", `${action}...`) + formatLineCountSuffix(lineCount, theme);
}

export function normalizePositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: undefined;
}

export function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function getRtkCompactionInfo(details: unknown): RtkCompactionInfo | undefined {
	const detailRecord = toRecord(details);
	const metadataRecord = toRecord(detailRecord.metadata);
	const topLevel = toRecord(detailRecord.rtkCompaction);
	const nested = toRecord(metadataRecord.rtkCompaction);

	const source =
		Object.keys(topLevel).length > 0
			? topLevel
			: Object.keys(nested).length > 0
				? nested
				: undefined;

	if (!source) {
		return undefined;
	}

	const techniques = toStringArray(source.techniques);
	const info: RtkCompactionInfo = {
		applied: source.applied === true,
		techniques,
		truncated: source.truncated === true,
		originalLineCount: normalizePositiveInteger(source.originalLineCount),
		compactedLineCount: normalizePositiveInteger(source.compactedLineCount),
	};

	if (
		!info.applied &&
		info.techniques.length === 0 &&
		!info.truncated &&
		info.originalLineCount === undefined &&
		info.compactedLineCount === undefined
	) {
		return undefined;
	}

	return info;
}

export function formatRtkTechniqueList(techniques: string[]): string {
	if (techniques.length === 0) {
		return "";
	}

	const visible = techniques.slice(0, 3).join(", ");
	const hidden = techniques.length - 3;
	return hidden > 0 ? `${visible}, +${hidden} more` : visible;
}

export function getRtkCompactionInfoIfApplied(
	details: unknown,
	config: ToolDisplayConfig,
): RtkCompactionInfo | undefined {
	if (!config.showRtkCompactionHints) {
		return undefined;
	}
	const info = getRtkCompactionInfo(details);
	return info?.applied ? info : undefined;
}

export function withRtkCompactionInfo(
	params: RtkHintParams,
	handler: (info: RtkCompactionInfo) => string,
): string {
	const info = getRtkCompactionInfoIfApplied(params.details, params.config);
	return info ? handler(info) : "";
}

export function handlePartialResult(
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	message: string,
): Text | undefined {
	return options.isPartial ? partialResultText(theme, message) : undefined;
}

export function renderSearchPreview(ctx: PreviewHintContext, expandedOnly = false): Text {
	return renderPreviewText(ctx.lines, ctx.config, ctx.theme, ctx.options, (p) => appendPreviewHints(p, ctx), expandedOnly);
}

export function renderMcpPreview(ctx: McpPreviewHintContext, expandedOnly = false): Text {
	return renderPreviewText(ctx.lines, ctx.config, ctx.theme, ctx.options, (p) => appendMcpPreviewHints(p, ctx), expandedOnly);
}

export function formatRtkSummarySuffix(params: RtkHintParams): string {
	const { theme } = params;
	return withRtkCompactionInfo(params, (info) => {
		const segments: string[] = [RTK_COMPACTION_LABEL];

		const techniqueText = formatRtkTechniqueList(info.techniques);
		if (techniqueText) {
			segments.push(techniqueText);
		}
		if (info.truncated) {
			segments.push("RTK removed content");
		}

		if (segments.length === 0) {
			return "";
		}

		return `\n${theme.fg("warning", `↳ (${segments.join(" • ")})`)}`;
	});
}

export function getExpandedPreviewLineLimit(
	lines: string[],
	config: ToolDisplayConfig,
): number {
	const limit = Math.max(0, config.expandedPreviewMaxLines);
	if (limit === 0) {
		return lines.length;
	}
	return Math.min(lines.length, limit);
}

export function formatExpandedPreviewCapHint(
	lines: string[],
	config: ToolDisplayConfig,
	theme: RenderTheme,
): string {
	const cap = Math.max(0, config.expandedPreviewMaxLines);
	if (cap === 0 || lines.length <= cap) {
		return "";
	}

	return `\n${theme.fg("warning", `(display capped at ${cap} lines by tool-display setting)`)}`;
}

export function formatRtkPreviewHint(params: RtkHintParams): string {
	const { theme } = params;
	return withRtkCompactionInfo(params, (info) => {
		const hints: string[] = [];
		const techniqueText = formatRtkTechniqueList(info.techniques);
		if (techniqueText) {
			hints.push(`${RTK_COMPACTION_LABEL}: ${techniqueText}`);
		} else {
			hints.push(`${RTK_COMPACTION_LABEL} applied`);
		}

		if (
			info.originalLineCount !== undefined &&
			info.compactedLineCount !== undefined &&
			info.originalLineCount > info.compactedLineCount
		) {
			hints.push(`${info.compactedLineCount}/${info.originalLineCount} lines kept`);
		}

		if (info.truncated) {
			hints.push("RTK removed content");
		}

		return hints.length > 0
			? `\n${theme.fg("warning", `(${hints.join(" • ")})`)}`
			: "";
	});
}

export function appendRtkAndExpandedHints(preview: string, ctx: PreviewHintContext): string {
	let result = preview + formatRtkPreviewHint(ctx);
	if (ctx.options.expanded) {
		result += formatExpandedPreviewCapHint(ctx.lines, ctx.config, ctx.theme);
	}
	return result;
}

export function appendMcpPreviewHints(preview: string, ctx: McpPreviewHintContext): string {
	let result = preview;
	if (ctx.config.showTruncationHints && (ctx.truncation.truncated || ctx.truncation.fullOutputPath)) {
		const hints: string[] = [];
		if (ctx.truncation.truncated) {
			hints.push("truncated by backend limits");
		}
		if (ctx.truncation.fullOutputPath) {
			hints.push(`full output: ${ctx.truncation.fullOutputPath}`);
		}
		result += `\n${ctx.theme.fg("warning", `(${hints.join(" • ")})`)}`;
	}
	return appendRtkAndExpandedHints(result, ctx);
}

export function appendPreviewHints(preview: string, ctx: PreviewHintContext): string {
	let result = preview;
	if (ctx.config.showTruncationHints && toRecord(toRecord(ctx.details).truncation).truncated) {
		result += `\n${ctx.theme.fg("warning", "(truncated by backend limits)")}`;
	}
	return appendRtkAndExpandedHints(result, ctx);
}

export function renderPreviewText(
	lines: string[],
	config: ToolDisplayConfig,
	theme: RenderTheme,
	options: ToolRenderResultOptions,
	appendHints: (preview: string) => string,
	expandedOnly: boolean = false,
): Text {
	const useExpanded = expandedOnly || options.expanded;
	const maxLines = useExpanded
		? getExpandedPreviewLineLimit(lines, config)
		: config.previewLines;
	const preview = buildPreviewText(lines, maxLines, theme, useExpanded);
	return textResult(appendHints(preview));
}

export function formatReadSummary(
	lines: string[],
	details: ReadToolDetails | undefined,
	theme: RenderTheme,
	showTruncationHints: boolean,
): string {
	const lineCount = lines.length;
	let summary = theme.fg(
		"muted",
		`↳ loaded ${lineCount} ${pluralize(lineCount, "line")}`,
	);
	summary += theme.fg(
		"warning",
		showTruncationHints ? truncationHint(details) : "",
	);
	return summary;
}

export function formatSearchSummary(
	lines: string[],
	unitLabel: string,
	details: { truncation?: { truncated?: boolean } } | undefined,
	theme: RenderTheme,
	showTruncationHints: boolean,
	pluralLabel?: string,
): string {
	const count = countNonEmptyLines(lines);
	let summary = theme.fg(
		"muted",
		`↳ ${count} ${pluralize(count, unitLabel, pluralLabel)} returned`,
	);
	summary += theme.fg(
		"warning",
		showTruncationHints ? truncationHint(details) : "",
	);
	return summary;
}

export function formatBashSummary(
	lines: string[],
	_details: BashToolDetails | undefined,
	theme: RenderTheme,
	_showTruncationHints: boolean,
): string {
	const lineCount = lines.length;
	return theme.fg(
		"muted",
		`↳ ${lineCount} ${pluralize(lineCount, "line")} returned`,
	);
}

export function formatBashTruncationHints(
	details: BashToolDetails | undefined,
	theme: RenderTheme,
): string {
	if (!details) {
		return "";
	}

	const hints: string[] = [];
	if (details.truncation?.truncated) {
		hints.push("output truncated");
	}
	if (details.fullOutputPath) {
		hints.push(`full output: ${details.fullOutputPath}`);
	}
	if (hints.length === 0) {
		return "";
	}
	return `\n${theme.fg("warning", `(${hints.join(" • ")})`)}`;
}

export function getBashPreviewLineLimit(
	lines: string[],
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
): number {
	if (options.expanded) {
		return getExpandedPreviewLineLimit(lines, config);
	}

	return config.bashOutputMode === "opencode"
		? config.bashCollapsedLines
		: config.previewLines;
}

export function textResult(text: string): Text {
	return new Text(text, 0, 0);
}

export function reuseTextComponent(text: string, cachedComponent?: Text): Text {
	if (cachedComponent) {
		cachedComponent.setText(text);
		return cachedComponent;
	}
	return textResult(text);
}

export function partialResultText(theme: RenderTheme, label: string): Text {
	return textResult(theme.fg("warning", label));
}

export function renderBashPreviewWithHints(
	lines: string[],
	maxLines: number,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	options: ToolRenderResultOptions,
	details: BashToolDetails | undefined,
	cachedComponent?: Text,
): Text {
	let preview = buildPreviewText(lines, maxLines, theme, options.expanded);
	if (config.showTruncationHints) {
		preview += formatBashTruncationHints(details, theme);
	}
	if (options.expanded) {
		preview += formatExpandedPreviewCapHint(lines, config, theme);
	}
	return reuseTextComponent(preview, cachedComponent);
}

export function prepareBashLivePreview(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
): { lines: string[]; maxLines: number } | undefined {
	const lines = prepareOutputLines(rawOutput, options);
	if (lines.length === 0) {
		return undefined;
	}
	const maxLines = getBashPreviewLineLimit(lines, options, config);
	if (!options.expanded && maxLines === 0) {
		return undefined;
	}
	return { lines, maxLines };
}

export function renderBashLivePreview(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	details: BashToolDetails | undefined,
	cachedComponent?: Text,
): Text {
	const prepared = prepareBashLivePreview(rawOutput, options, config);
	if (!prepared) {
		return reuseTextComponent("", cachedComponent);
	}
	return renderBashPreviewWithHints(prepared.lines, prepared.maxLines, config, theme, options, details, cachedComponent);
}

export function renderBashErrorResult(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	details: BashToolDetails | undefined,
	cachedComponent?: Text,
): Text {
	const lines = prepareOutputLines(rawOutput, options);
	let text = theme.fg("error", "↳ command failed");

	if (lines.length > 0) {
		const maxLines = getBashPreviewLineLimit(lines, options, config);
		if (options.expanded || maxLines > 0) {
			const { shown, remaining } = previewLines(lines, maxLines);
			text += `\n${shown
				.map((line) => theme.fg("error", sanitizeAnsiForThemedOutput(line)))
				.join("\n")}`;
			text += formatTruncationHint(remaining, options.expanded, theme);
		}
	}

	if (config.showTruncationHints) {
		text += formatBashTruncationHints(details, theme);
	}
	if (options.expanded && lines.length > 0) {
		text += formatExpandedPreviewCapHint(lines, config, theme);
	}

	return reuseTextComponent(text, cachedComponent);
}

export function isBackgroundTaskResult(
	result: Record<string, unknown>,
	context?: ToolRenderContextLike,
): boolean {
	const args = context?.args as Record<string, unknown> | undefined;
	if (args?.background === true) return true;
	if (
		typeof args?.taskAction === "string" &&
		args.taskAction.trim() !== "" &&
		args.taskAction !== "null" &&
		args.taskAction !== "undefined"
	) {
		return true;
	}
	const details = result.details as Record<string, unknown> | undefined;
	if (
		details &&
		typeof details.id === "string" &&
		details.id.startsWith("task-") &&
		typeof details.status === "string"
	) {
		return true;
	}
	return false;
}

export function formatArgCountSuffix(argCount: number, theme: RenderTheme): string {
	return argCount === 0
		? theme.fg("muted", " (no args)")
		: theme.fg("muted", ` (${argCount} ${pluralize(argCount, "arg")})`);
}

export function getSearchScope(args: Record<string, unknown>): string {
	return shortenPath((args.path as string) || ".");
}

export function formatSearchCallLine(
	toolName: string,
	accent: string,
	mutedSuffix: string,
	theme: RenderTheme,
): Text {
	return new Text(
		`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", accent)}${theme.fg("muted", mutedSuffix)}`,
		0,
		0,
	);
}

export function formatGenericToolCallLine(
	toolName: string,
	args: unknown,
	theme: RenderTheme,
): Text {
	const argRecord = toRecord(args);
	const argCount = Object.keys(argRecord).length;
	const argSuffix = formatArgCountSuffix(argCount, theme);
	return new Text(
		`${theme.fg("toolTitle", theme.bold(toolName))}${argSuffix}`,
		0,
		0,
	);
}
