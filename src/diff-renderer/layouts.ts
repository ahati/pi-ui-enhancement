import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildCollapsedDiffHintText } from "../line-width-safety.js";
import { type DiffPresentationMode } from "../diff-presentation.js";
import { pluralize, sanitizeAnsiForThemedOutput } from "../render-utils.js";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type DiffIndicatorMode } from "../types.js";
import type {
	CodeLineHighlighter,
	DiffLineEntry,
	DiffLineKind,
	DiffMetaEntry,
	DiffPalette,
	DiffRenderContext,
	DiffSpan,
	DiffStats,
	DiffSyntaxOverride,
	DiffTheme,
	ParsedDiffEntry,
	RenderedRow,
	SplitDiffRow,
} from "./types.js";
import {
	DIFF_WIDTH_OPS,
	clampDiffLineToWidth,
	fitToWidth,
	readThemeAnsi,
	stabilizeBackgroundResets,
	wrapToWidth,
} from "./palette.js";
import { formatLineNumberLabel } from "./parser.js";
import {
	applyContextDim,
	emphasis,
	highlightDiffLine,
	normalizeCodeWhitespace,
} from "./syntax.js";
import {
	buildLineCellParams,
	computeLineCellCodeWidth,
	getHashlineGutterMarkerWidth,
	getLineContentIndicatorPrefixPlainWidth,
	getLinePrefixPlainWidth,
	pushDiffLineRows,
	renderCodeDivider,
	renderCompactLineCell,
	renderLineCell,
	renderLineContentIndicatorPrefix,
	renderLinePrefix,
	usesHashlineGutter,
} from "./cells.js";

export const SPLIT_SEPARATOR = " │ ";
export const MIN_SPLIT_COLUMN_WIDTH = 24;

export function collectConsecutiveLineEntries(
	entries: ParsedDiffEntry[],
	startIndex: number,
	lineKind: DiffLineKind,
): { collected: DiffLineEntry[]; nextIndex: number } {
	const collected: DiffLineEntry[] = [];
	let index = startIndex;
	while (index < entries.length) {
		const candidate = entries[index];
		if (!candidate || candidate.kind !== "line" || candidate.lineKind !== lineKind) {
			break;
		}
		collected.push(candidate);
		index++;
	}
	return { collected, nextIndex: index };
}

export function buildSplitRows(entries: ParsedDiffEntry[]): SplitDiffRow[] {
	const rows: SplitDiffRow[] = [];
	let index = 0;

	while (index < entries.length) {
		const entry = entries[index];
		if (!entry) {
			break;
		}

		if (entry.kind !== "line") {
			rows.push({ meta: entry, hunkIndex: entry.hunkIndex || null });
			index++;
			continue;
		}

		if (entry.lineKind === "remove") {
			const removedResult = collectConsecutiveLineEntries(entries, index, "remove");
			const removed = removedResult.collected;
			const addedResult = collectConsecutiveLineEntries(entries, removedResult.nextIndex, "add");
			const added = addedResult.collected;
			index = addedResult.nextIndex;

			const pairCount = Math.max(removed.length, added.length);
			for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
				const left = removed[pairIndex];
				const right = added[pairIndex];
				rows.push({
					left,
					right,
					hunkIndex: left?.hunkIndex ?? right?.hunkIndex ?? null,
				});
			}
			continue;
		}

		if (entry.lineKind === "add") {
			rows.push({ right: entry, hunkIndex: entry.hunkIndex || null });
			index++;
			continue;
		}

		rows.push({ left: entry, right: entry, hunkIndex: entry.hunkIndex || null });
		index++;
	}

	return rows;
}

export function getCellLineNumber(line: DiffLineEntry, side: "left" | "right"): number | null {
	if (side === "left") {
		return line.oldLineNumber ?? (line.lineKind === "context" ? line.newLineNumber : null);
	}
	return line.newLineNumber ?? (line.lineKind === "context" ? line.oldLineNumber : null);
}

export function formatMetaEntryRows(entry: DiffMetaEntry, width: number, theme: DiffTheme, wordWrap: boolean): RenderedRow[] {
	const normalized = sanitizeAnsiForThemedOutput(normalizeCodeWhitespace(entry.raw));
	const lines = wordWrap
		? wrapToWidth(normalized, width, true)
		: [truncateToWidth(normalized, width)];

	const mapColor = (line: string): string => {
		if (entry.kind === "hunk") {
			return stabilizeBackgroundResets(theme.fg("accent", line));
		}
		if (entry.kind === "file") {
			return stabilizeBackgroundResets(theme.fg("muted", line));
		}
		return stabilizeBackgroundResets(theme.fg("toolDiffContext", line));
	};

	return lines.map((line) => ({
		text: mapColor(line),
		hunkIndex: entry.kind === "file" ? null : entry.hunkIndex || null,
	}));
}

export function processDiffEntries(
	entries: ParsedDiffEntry[],
	ctx: DiffRenderContext,
	processLine: (entry: DiffLineEntry) => string[],
): RenderedRow[] {
	const { width, theme, wordWrap } = ctx;
	const rows: RenderedRow[] = [];
	for (const entry of entries) {
		if (entry.kind !== "line") {
			rows.push(...formatMetaEntryRows(entry, width, theme, wordWrap));
			continue;
		}
		pushDiffLineRows(rows, processLine(entry), entry);
	}
	return rows;
}

export function renderUnified(
	entries: ParsedDiffEntry[],
	ctx: DiffRenderContext,
	lineNumberWidth: number,
): RenderedRow[] {
	return processDiffEntries(entries, ctx, (entry) => {
		const lineNumber = entry.lineKind === "add"
			? formatLineNumberLabel(entry, entry.newLineNumber, entry.fallbackLineNumber, lineNumberWidth, ctx.showHashlineAnchors)
			: formatLineNumberLabel(entry, entry.oldLineNumber, entry.fallbackLineNumber, lineNumberWidth, ctx.showHashlineAnchors);
		const codeText = normalizeCodeWhitespace(entry.content);
		const { highlighted, rowBg } = highlightDiffLine(codeText, entry, ctx.inlineHighlights, ctx.palette, ctx.highlightLine, ctx.containerBgAnsi, ctx.syntaxOverride);
		const cells = renderLineCell(
			buildLineCellParams(entry.lineKind, highlighted, ctx.width, rowBg, ctx.containerBgAnsi, ctx.theme, ctx.wordWrap, ctx.indicatorMode),
			lineNumber,
			usesHashlineGutter(ctx.showHashlineAnchors),
		);
		return entry.lineKind === "context" ? cells.map(applyContextDim) : cells;
	});
}

export function toUnifiedFallbackRows(
	rows: SplitDiffRow[],
	ctx: DiffRenderContext,
	lineNumberWidth: number,
): RenderedRow[] {
	const flattened: ParsedDiffEntry[] = [];
	for (const row of rows) {
		if (row.meta) {
			flattened.push(row.meta);
			continue;
		}
		if (row.left) {
			flattened.push(row.left);
		}
		if (row.right && row.right !== row.left) {
			flattened.push(row.right);
		}
	}
	return renderUnified(flattened, ctx, lineNumberWidth);
}

export function renderCompact(
	entries: ParsedDiffEntry[],
	ctx: DiffRenderContext,
): RenderedRow[] {
	return processDiffEntries(entries, ctx, (entry) => {
		const codeText = normalizeCodeWhitespace(
			ctx.showHashlineAnchors && entry.hashlineAnchorContent
				? entry.hashlineAnchorContent
				: entry.content
		);
		const { highlighted, rowBg } = highlightDiffLine(codeText, entry, ctx.inlineHighlights, ctx.palette, ctx.highlightLine, ctx.containerBgAnsi, ctx.syntaxOverride);
		const cells = renderCompactLineCell(buildLineCellParams(entry.lineKind, highlighted, ctx.width, rowBg, ctx.containerBgAnsi, ctx.theme, ctx.wordWrap, ctx.indicatorMode));
		return entry.lineKind === "context" ? cells.map(applyContextDim) : cells;
	});
}

export function renderSplitBlankCell(
	columnWidth: number,
	lineNumberWidth: number,
	theme: DiffTheme,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter = false,
): string {
	const codeWidth = computeLineCellCodeWidth(columnWidth, lineNumberWidth, indicatorMode, hashlineGutter);
	const prefix = renderLinePrefix("context", " ".repeat(lineNumberWidth), theme, undefined, indicatorMode, true, hashlineGutter);
	const divider = renderCodeDivider(theme, undefined, indicatorMode, hashlineGutter);
	const contentPrefix = hashlineGutter ? "" : renderLineContentIndicatorPrefix("context", theme, undefined, indicatorMode, true);
	return stabilizeBackgroundResets(`${prefix}${divider}${contentPrefix}${" ".repeat(codeWidth)}`);
}

export function renderSplitCell(
	line: DiffLineEntry | undefined,
	side: "left" | "right",
	columnWidth: number,
	lineNumberWidth: number,
	theme: DiffTheme,
	inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>,
	palette: DiffPalette,
	highlightLine: CodeLineHighlighter,
	syntaxOverride: DiffSyntaxOverride | undefined,
	containerBgAnsi: string | undefined,
	wordWrap: boolean,
	indicatorMode: DiffIndicatorMode,
	showHashlineAnchors: boolean,
): string[] {
	const hashlineGutter = usesHashlineGutter(showHashlineAnchors);
	if (!line) {
		return [renderSplitBlankCell(columnWidth, lineNumberWidth, theme, indicatorMode, hashlineGutter)];
	}

	const lineNumber = formatLineNumberLabel(line, getCellLineNumber(line, side), line.fallbackLineNumber, lineNumberWidth, showHashlineAnchors);
	const codeText = normalizeCodeWhitespace(line.content);
	const { highlighted, rowBg } = highlightDiffLine(codeText, line, inlineHighlights, palette, highlightLine, containerBgAnsi, syntaxOverride);
	const cells = renderLineCell(
		buildLineCellParams(line.lineKind, highlighted, columnWidth, rowBg, containerBgAnsi, theme, wordWrap, indicatorMode),
		lineNumber,
		hashlineGutter,
	);
	return line.lineKind === "context" ? cells.map(applyContextDim) : cells;
}

export function renderSplitDivider(
	theme: DiffTheme,
	containerBgAnsi: string | undefined,
	separatorText: string = SPLIT_SEPARATOR,
): string {
	const dimAnsi = readThemeAnsi(theme, "fg", "dim");
	if (!containerBgAnsi) {
		return stabilizeBackgroundResets(theme.fg("dim", separatorText));
	}
	if (!dimAnsi) {
		return stabilizeBackgroundResets(`${containerBgAnsi}${theme.fg("dim", separatorText)}${containerBgAnsi}`);
	}
	return stabilizeBackgroundResets(`${containerBgAnsi}${dimAnsi}${separatorText}\x1b[39m${containerBgAnsi}`);
}

export function renderSplitTopBorderCell(
	columnWidth: number,
	lineNumberWidth: number,
	theme: DiffTheme,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter = false,
): string {
	const safeColumnWidth = Math.max(1, columnWidth);
	const chars = "─".repeat(safeColumnWidth).split("");
	const dividerIndex = getLinePrefixPlainWidth(lineNumberWidth, indicatorMode, hashlineGutter);
	if (dividerIndex >= 0 && dividerIndex < chars.length) {
		chars[dividerIndex] = "┬";
	}
	return stabilizeBackgroundResets(theme.fg("dim", chars.join("")));
}

export function renderSplitHeaderCell(
	label: string,
	columnWidth: number,
	lineNumberWidth: number,
	theme: DiffTheme,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter = false,
): string {
	const markerPad = hashlineGutter
		? " ".repeat(getHashlineGutterMarkerWidth(indicatorMode))
		: indicatorMode === "bars" ? "  " : "";
	const lineNumberLabel = fitToWidth(label, lineNumberWidth);
	const lineNumberSpacer = hashlineGutter ? "" : " ";
	const divider = hashlineGutter || indicatorMode !== "classic" ? "│ " : "│";
	const prefix = `${theme.fg("dim", markerPad)}${theme.fg("muted", lineNumberLabel)}${theme.fg("dim", lineNumberSpacer)}${theme.fg("dim", divider)}`;
	const prefixWidth = visibleWidth(`${markerPad}${lineNumberLabel}${lineNumberSpacer}${divider}`);
	const contentIndicatorWidth = hashlineGutter ? 0 : getLineContentIndicatorPrefixPlainWidth(indicatorMode);
	const codeWidth = Math.max(0, columnWidth - prefixWidth - contentIndicatorWidth);
	const contentPad = !hashlineGutter && indicatorMode === "classic" ? "  " : "";
	return stabilizeBackgroundResets(`${prefix}${contentPad}${" ".repeat(codeWidth)}`);
}

export function canRenderSplitLayout(width: number): boolean {
	const separatorWidth = visibleWidth(SPLIT_SEPARATOR);
	const minimumSplitWidth = MIN_SPLIT_COLUMN_WIDTH * 2 + separatorWidth;
	return width >= minimumSplitWidth;
}

export function renderSplit(
	rows: SplitDiffRow[],
	ctx: DiffRenderContext,
	lineNumberWidth: number,
): RenderedRow[] {
	const { width, theme, inlineHighlights, palette, highlightLine, syntaxOverride, containerBgAnsi, wordWrap, indicatorMode, showHashlineAnchors } = ctx;
	if (!canRenderSplitLayout(width)) {
		return toUnifiedFallbackRows(rows, ctx, lineNumberWidth);
	}

	const separatorWidth = visibleWidth(SPLIT_SEPARATOR);
	const leftWidth = Math.max(MIN_SPLIT_COLUMN_WIDTH, Math.floor((width - separatorWidth) / 2));
	const rightWidth = Math.max(MIN_SPLIT_COLUMN_WIDTH, width - separatorWidth - leftWidth);
	const splitLineNumberWidth = Math.max(3, lineNumberWidth);
	const hashlineGutter = usesHashlineGutter(showHashlineAnchors);
	const separator = renderSplitDivider(theme, containerBgAnsi);
	const topSeparator = renderSplitDivider(theme, containerBgAnsi, "─┬─");
	const output: RenderedRow[] = [];
	output.push({
		text: `${renderSplitTopBorderCell(leftWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter)}${topSeparator}${renderSplitTopBorderCell(rightWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter)}`,
		hunkIndex: null,
	});
	output.push({
		text: `${renderSplitHeaderCell("old", leftWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter)}${separator}${renderSplitHeaderCell("new", rightWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter)}`,
		hunkIndex: null,
	});

	for (const row of rows) {
		if (row.meta) {
			output.push(...formatMetaEntryRows(row.meta, width, theme, wordWrap));
			continue;
		}

		const leftCells = renderSplitCell(
			row.left,
			"left",
			leftWidth,
			splitLineNumberWidth,
			theme,
			inlineHighlights,
			palette,
			highlightLine,
			syntaxOverride,
			containerBgAnsi,
			wordWrap,
			indicatorMode,
			showHashlineAnchors,
		);
		const rightCells = renderSplitCell(
			row.right,
			"right",
			rightWidth,
			splitLineNumberWidth,
			theme,
			inlineHighlights,
			palette,
			highlightLine,
			syntaxOverride,
			containerBgAnsi,
			wordWrap,
			indicatorMode,
			showHashlineAnchors,
		);

		const rowCount = Math.max(leftCells.length, rightCells.length);
		for (let index = 0; index < rowCount; index++) {
			const leftCell = leftCells[index] ?? renderSplitBlankCell(leftWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter);
			const rightCell = rightCells[index] ?? renderSplitBlankCell(rightWidth, splitLineNumberWidth, theme, indicatorMode, hashlineGutter);
			output.push({ text: `${leftCell}${separator}${rightCell}`, hunkIndex: row.hunkIndex });
		}
	}

	return output;
}

export function renderDiffStatBar(stats: DiffStats, width: number, theme: DiffTheme): string | null {
	const totalChanges = stats.added + stats.removed;
	if (totalChanges === 0 || width < 20) {
		return null;
	}

	const barSlots = Math.max(8, Math.min(24, Math.floor(width / 12)));
	let addedSlots = Math.max(0, Math.min(barSlots, Math.round((stats.added / totalChanges) * barSlots)));
	if (stats.added > 0 && addedSlots === 0) {
		addedSlots = 1;
	}
	if (stats.removed > 0 && addedSlots >= barSlots) {
		addedSlots = barSlots - 1;
	}
	const removedSlots = Math.max(0, barSlots - addedSlots);

	const addedBar = addedSlots > 0 ? theme.fg("toolDiffAdded", "━".repeat(addedSlots)) : "";
	const removedBar = removedSlots > 0 ? theme.fg("toolDiffRemoved", "━".repeat(removedSlots)) : "";
	return stabilizeBackgroundResets(`${theme.fg("dim", "[")}${addedBar}${removedBar}${theme.fg("dim", "]")}`);
}

export function buildDiffSummaryBasePieces(stats: DiffStats, theme: DiffTheme): string[] {
	return [
		theme.fg("toolOutput", `↳ ${emphasis(theme, "diff")}`),
		theme.fg("toolDiffAdded", `+${stats.added}`),
		theme.fg("toolDiffRemoved", `-${stats.removed}`),
	];
}

export function renderHeaderRows(stats: DiffStats, mode: Exclude<DiffPresentationMode, "summary">, width: number, theme: DiffTheme): RenderedRow[] {
	if (mode === "compact") {
		const summary = buildDiffSummaryBasePieces(stats, theme).join(" ");
		return [{ text: stabilizeBackgroundResets(truncateToWidth(summary, width)), hunkIndex: null }];
	}

	const summaryPieces = mode === "split"
		? [
			...buildDiffSummaryBasePieces(stats, theme),
			theme.fg("muted", mode),
		]
		: [
			...buildDiffSummaryBasePieces(stats, theme),
			theme.fg("muted", `${stats.hunks} ${pluralize(stats.hunks, "hunk")}`),
			theme.fg("muted", `${stats.files} ${pluralize(stats.files, "file")}`),
			theme.fg("muted", mode),
		];

	const summary = summaryPieces.join(mode === "split" ? " " : theme.fg("muted", " • "));
	const meter = renderDiffStatBar(stats, width, theme);
	if (!meter) {
		return [{ text: stabilizeBackgroundResets(truncateToWidth(summary, width)), hunkIndex: null }];
	}

	const meterSeparator = " ";
	const meterWidth = visibleWidth(meterSeparator) + visibleWidth(meter);
	if (meterWidth >= width) {
		return [{ text: stabilizeBackgroundResets(truncateToWidth(summary, width)), hunkIndex: null }];
	}

	const summaryWidth = Math.max(0, width - meterWidth);
	const fittedSummary = truncateToWidth(summary, summaryWidth);
	return [{ text: stabilizeBackgroundResets(`${fittedSummary}${meterSeparator}${meter}`), hunkIndex: null }];
}

export function renderDiffFrameLine(width: number, theme: DiffTheme): string {
	const frameWidth = Math.max(0, width);
	if (frameWidth === 0) {
		return "";
	}
	return stabilizeBackgroundResets(theme.fg("dim", "─".repeat(frameWidth)));
}

export function renderDiffSpacerLine(width: number): string {
	const safeWidth = Math.max(0, width);
	return safeWidth > 0 ? " ".repeat(safeWidth) : "";
}

export function applyLineLimit(
	rows: RenderedRow[],
	width: number,
	expanded: boolean,
	maxCollapsedLines: number,
	maxExpandedLines: number,
	totalHunks: number,
	theme: DiffTheme,
): string[] {
	const expandedLimit = Number.isFinite(maxExpandedLines)
		? maxExpandedLines
		: DEFAULT_TOOL_DISPLAY_CONFIG.expandedPreviewMaxLines;
	const collapsedLimit = Number.isFinite(maxCollapsedLines)
		? maxCollapsedLines
		: DEFAULT_TOOL_DISPLAY_CONFIG.diffCollapsedLines;
	const limit = expanded ? Math.max(0, expandedLimit) : Math.max(1, collapsedLimit);
	if (limit === 0 || rows.length <= limit) {
		return rows.map((row) => clampDiffLineToWidth(row.text, width));
	}

	const shown = rows.slice(0, limit);
	const remaining = rows.length - shown.length;
	const visibleHunks = new Set(
		shown
			.map((row) => row.hunkIndex)
			.filter((hunkIndex): hunkIndex is number => typeof hunkIndex === "number" && hunkIndex > 0),
	);
	const hiddenHunks = Math.max(0, totalHunks - visibleHunks.size);
	const hintText = buildCollapsedDiffHintText(
		{
			remainingLines: remaining,
			hiddenHunks,
		},
		width,
		DIFF_WIDTH_OPS,
	);

	return [
		...shown.map((row) => clampDiffLineToWidth(row.text, width)),
		renderDiffSpacerLine(width),
		clampDiffLineToWidth(theme.fg(expanded ? "warning" : "muted", hintText), width),
	];
}

export function renderSingleDiffRow(text: string, color: string, width: number, theme: DiffTheme): string[] {
	if (width <= 0) {
		return [""];
	}
	return [clampDiffLineToWidth(stabilizeBackgroundResets(theme.fg(color, text)), width)];
}

export function createDiffRenderCache() {
	let cachedWidth: number | undefined;
	let cachedExpanded: boolean | undefined;
	let cachedMode: DiffPresentationMode | undefined;
	let cachedLines: string[] | undefined;

	return {
		get(width: number, expanded: boolean, mode: DiffPresentationMode): string[] | undefined {
			if (cachedLines && cachedWidth === width && cachedExpanded === expanded && cachedMode === mode) {
				return cachedLines;
			}
			return undefined;
		},
		set(width: number, expanded: boolean, mode: DiffPresentationMode, lines: string[]): string[] {
			cachedWidth = width;
			cachedExpanded = expanded;
			cachedMode = mode;
			cachedLines = lines;
			return lines;
		},
		invalidate(): void {
			cachedWidth = undefined;
			cachedExpanded = undefined;
			cachedMode = undefined;
			cachedLines = undefined;
		},
	};
}
