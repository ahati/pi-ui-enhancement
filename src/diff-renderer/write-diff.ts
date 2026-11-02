import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
	buildDiffSummaryText,
	normalizeDiffRenderWidth,
	resolveDiffPresentationMode,
	type DiffPresentationMode,
} from "../diff-presentation.js";
import type { ToolDisplayConfig } from "../types.js";
import { splitWriteContentLines } from "../write-display-utils.js";
import { resolveDiffIndicatorMode } from "./cells.js";
import { buildInlineHighlightMap } from "./inline.js";
import {
	applyLineLimit,
	buildSplitRows,
	canRenderSplitLayout,
	createDiffRenderCache,
	renderCompact,
	renderDiffFrameLine,
	renderSingleDiffRow,
	renderSplit,
	renderUnified,
} from "./layouts.js";
import {
	clampDiffLinesToWidth,
	resolveContainerBackgroundAnsi,
	resolveDiffPalette,
	stabilizeBackgroundResets,
} from "./palette.js";
import { collectDiffStats, getLineNumberWidth } from "./parser.js";
import {
	buildDiffSyntaxOverride,
	createDiffCodeHighlighter,
	emphasis,
	resolveLanguageFromPath,
} from "./syntax.js";
import type {
	DiffLineEntry,
	DiffRenderContext,
	DiffRenderOptions,
	DiffSpan,
	DiffStats,
	DiffTheme,
	ParsedDiffEntry,
	RenderedRow,
	SplitDiffRow,
} from "./types.js";

export function renderWriteHeader(
	wasOverwrite: boolean,
	width: number,
	theme: DiffTheme,
	headerLabel?: string,
): string {
	const actionLabel = headerLabel?.trim() || (wasOverwrite ? "overwritten" : "created");
	return stabilizeBackgroundResets(
		truncateToWidth(theme.fg("toolOutput", `↳ ${emphasis(theme, actionLabel)}`), width),
	);
}

export type WriteDiffOperationKind = "context" | "remove" | "add";

export interface WriteDiffOperation {
	kind: WriteDiffOperationKind;
	content: string;
}

export function buildWriteDiffOperations(oldLines: string[], newLines: string[]): WriteDiffOperation[] {
	const oldLength = oldLines.length;
	const newLength = newLines.length;
	const table: number[][] = Array.from({ length: oldLength + 1 }, () => Array<number>(newLength + 1).fill(0));

	for (let oldIndex = 1; oldIndex <= oldLength; oldIndex++) {
		for (let newIndex = 1; newIndex <= newLength; newIndex++) {
			if ((oldLines[oldIndex - 1] ?? "") === (newLines[newIndex - 1] ?? "")) {
				table[oldIndex]![newIndex] = (table[oldIndex - 1]?.[newIndex - 1] ?? 0) + 1;
				continue;
			}
			const top = table[oldIndex - 1]?.[newIndex] ?? 0;
			const left = table[oldIndex]?.[newIndex - 1] ?? 0;
			table[oldIndex]![newIndex] = Math.max(top, left);
		}
	}

	const operations: WriteDiffOperation[] = [];
	let oldCursor = oldLength;
	let newCursor = newLength;

	while (oldCursor > 0 || newCursor > 0) {
		const oldLine = oldCursor > 0 ? (oldLines[oldCursor - 1] ?? "") : undefined;
		const newLine = newCursor > 0 ? (newLines[newCursor - 1] ?? "") : undefined;

		if (oldCursor > 0 && newCursor > 0 && oldLine === newLine) {
			operations.push({ kind: "context", content: oldLine ?? "" });
			oldCursor--;
			newCursor--;
			continue;
		}

		const top = oldCursor > 0 ? (table[oldCursor - 1]?.[newCursor] ?? 0) : -1;
		const left = newCursor > 0 ? (table[oldCursor]?.[newCursor - 1] ?? 0) : -1;

		if (newCursor > 0 && left >= top) {
			operations.push({ kind: "add", content: newLine ?? "" });
			newCursor--;
			continue;
		}

		if (oldCursor > 0) {
			operations.push({ kind: "remove", content: oldLine ?? "" });
			oldCursor--;
		}
	}

	operations.reverse();
	return operations;
}

export function buildWriteEntries(lines: string[]): ParsedDiffEntry[] {
	return lines.map((line, index) => ({
		kind: "line",
		lineKind: "add",
		oldLineNumber: null,
		newLineNumber: index + 1,
		fallbackLineNumber: `${index + 1}`,
		content: line,
		raw: `+${line}`,
		hunkIndex: 1,
	}));
}

export function buildWriteOverwriteEntries(oldLines: string[], newLines: string[]): ParsedDiffEntry[] {
	const operations = buildWriteDiffOperations(oldLines, newLines);
	const entries: ParsedDiffEntry[] = [];
	let oldLineNumber = 1;
	let newLineNumber = 1;

	for (const operation of operations) {
		if (operation.kind === "context") {
			entries.push({
				kind: "line",
				lineKind: "context",
				oldLineNumber,
				newLineNumber,
				fallbackLineNumber: `${newLineNumber}`,
				content: operation.content,
				raw: ` ${operation.content}`,
				hunkIndex: 1,
			});
			oldLineNumber++;
			newLineNumber++;
			continue;
		}

		if (operation.kind === "remove") {
			entries.push({
				kind: "line",
				lineKind: "remove",
				oldLineNumber,
				newLineNumber: null,
				fallbackLineNumber: `${oldLineNumber}`,
				content: operation.content,
				raw: `-${operation.content}`,
				hunkIndex: 1,
			});
			oldLineNumber++;
			continue;
		}

		entries.push({
			kind: "line",
			lineKind: "add",
			oldLineNumber: null,
			newLineNumber,
			fallbackLineNumber: `${newLineNumber}`,
			content: operation.content,
			raw: `+${operation.content}`,
			hunkIndex: 1,
		});
		newLineNumber++;
	}

	return entries;
}

export interface WriteDiffData {
	entries: ParsedDiffEntry[];
	splitRows: SplitDiffRow[];
	inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>;
	lineNumberWidth: number;
	stats: DiffStats;
	hunkCount: number;
}

export interface WriteOverwriteGuard {
	previousLineCount: number;
	nextLineCount: number;
}

export const MAX_WRITE_OVERWRITE_DIFF_LINES = 4000;
export const MAX_WRITE_OVERWRITE_DIFF_MATRIX_CELLS = 1_000_000;

export function buildApproximateWriteStats(
	lineCount: number,
	previousLineCount: number,
	hasComparablePrevious: boolean,
): DiffStats {
	const removed = hasComparablePrevious ? previousLineCount : 0;
	const added = lineCount;
	const hasContent = lineCount > 0 || removed > 0;
	return {
		added,
		removed,
		context: 0,
		hunks: hasContent ? 1 : 0,
		files: 1,
		lines: added + removed,
	};
}

export function buildWriteDiffData(entries: ParsedDiffEntry[]): WriteDiffData {
	const splitRows = buildSplitRows(entries);
	const inlineHighlights = buildInlineHighlightMap(splitRows);
	const lineNumberWidth = getLineNumberWidth(entries);
	const hunkCount = entries.length > 0 ? 1 : 0;
	const stats = collectDiffStats(entries, hunkCount, 1);
	return {
		entries,
		splitRows,
		inlineHighlights,
		lineNumberWidth,
		stats,
		hunkCount,
	};
}

export function resolveWriteOverwriteGuard(
	previousLines: string[],
	nextLines: string[],
): WriteOverwriteGuard | undefined {
	const previousLineCount = previousLines.length;
	const nextLineCount = nextLines.length;
	if (previousLineCount > MAX_WRITE_OVERWRITE_DIFF_LINES || nextLineCount > MAX_WRITE_OVERWRITE_DIFF_LINES) {
		return { previousLineCount, nextLineCount };
	}
	if (previousLineCount === 0 || nextLineCount === 0) {
		return undefined;
	}
	return previousLineCount * nextLineCount > MAX_WRITE_OVERWRITE_DIFF_MATRIX_CELLS
		? { previousLineCount, nextLineCount }
		: undefined;
}

export function buildWriteOverwriteGuardText(guard: WriteOverwriteGuard, width: number): string {
	const safeWidth = normalizeDiffRenderWidth(width);
	if (safeWidth === 0) {
		return "";
	}

	const candidates = [
		`↳ overwrite diff omitted (${guard.previousLineCount} → ${guard.nextLineCount} lines)`,
		`↳ overwrite diff omitted (${guard.previousLineCount}→${guard.nextLineCount})`,
		"↳ overwrite diff omitted",
		"diff omitted",
		"…",
	];
	for (const candidate of candidates) {
		if (visibleWidth(candidate) <= safeWidth) {
			return candidate;
		}
	}
	return truncateToWidth(candidates[candidates.length - 1] ?? "", safeWidth, "");
}

export function renderWriteOverwriteGuardRows(
	guard: WriteOverwriteGuard,
	width: number,
	theme: DiffTheme,
): string[] {
	return renderSingleDiffRow(buildWriteOverwriteGuardText(guard, width), "warning", width, theme);
}

export function renderWriteDiffResult(
	content: string | undefined,
	options: DiffRenderOptions,
	config: ToolDisplayConfig,
	theme: DiffTheme,
	fallbackText: string,
): Component {
	if (typeof content !== "string") {
		if (!fallbackText.trim()) {
			return new Text(theme.fg("muted", "↳ write completed"), 0, 0);
		}
		return new Text(theme.fg("toolOutput", fallbackText), 0, 0);
	}

	const filePath = options.filePath?.trim() || "(unknown path)";
	const lines = splitWriteContentLines(content);
	const previousLines = typeof options.previousContent === "string"
		? splitWriteContentLines(options.previousContent)
		: [];
	const hasComparablePrevious = options.fileExistedBeforeWrite === true && typeof options.previousContent === "string";
	const approximateStats = buildApproximateWriteStats(
		lines.length,
		previousLines.length,
		hasComparablePrevious,
	);
	const overwriteGuard = hasComparablePrevious
		? resolveWriteOverwriteGuard(previousLines, lines)
		: undefined;
	const palette = resolveDiffPalette(theme, config);
	const containerBgAnsi = resolveContainerBackgroundAnsi(theme);
	const language = resolveLanguageFromPath(filePath);
	const highlightLine = createDiffCodeHighlighter(language, config);
	const wordWrap = config.diffWordWrap;
	const indicatorMode = resolveDiffIndicatorMode(config);

	let detailedData: WriteDiffData | undefined;
	const cache = createDiffRenderCache();

	function getDetailedData(): WriteDiffData {
		if (detailedData) {
			return detailedData;
		}
		const entries = hasComparablePrevious
			? buildWriteOverwriteEntries(previousLines, lines)
			: buildWriteEntries(lines);
		detailedData = buildWriteDiffData(entries);
		return detailedData;
	}

	return {
		render(width: number): string[] {
			const safeWidth = normalizeDiffRenderWidth(width);
			const resolvedMode = resolveDiffPresentationMode(config, safeWidth, canRenderSplitLayout(safeWidth));
			const mode: DiffPresentationMode = hasComparablePrevious
				? resolvedMode
				: resolvedMode === "split"
					? "unified"
					: resolvedMode;
			const cached = cache.get(safeWidth, options.expanded, mode);
			if (cached) {
				return cached;
			}

			const header = renderWriteHeader(
				options.fileExistedBeforeWrite === true,
				safeWidth,
				theme,
				options.headerLabel,
			);
			if (overwriteGuard) {
				return cache.set(safeWidth, options.expanded, mode, clampDiffLinesToWidth(
					[header, ...renderWriteOverwriteGuardRows(overwriteGuard, safeWidth, theme)],
					safeWidth,
				));
			}

			if (mode === "summary") {
				const summaryRows = approximateStats.lines === 0
					? [header]
					: [header, ...renderSingleDiffRow(buildDiffSummaryText(approximateStats, safeWidth), "toolOutput", safeWidth, theme)];
				return cache.set(safeWidth, options.expanded, mode, clampDiffLinesToWidth(summaryRows, safeWidth));
			}

			const data = getDetailedData();
			const syntaxOverride = buildDiffSyntaxOverride(data.entries, language, config, highlightLine);
			const renderCtx: DiffRenderContext = {
				width: safeWidth,
				theme,
				inlineHighlights: data.inlineHighlights,
				palette,
				highlightLine,
				syntaxOverride,
				containerBgAnsi,
				wordWrap,
				indicatorMode,
				showHashlineAnchors: false,
			};
			const bodyRows: RenderedRow[] = data.entries.length === 0
				? [{ text: theme.fg("muted", "(empty file)"), hunkIndex: null }]
				: mode === "split"
					? renderSplit(
						data.splitRows,
						renderCtx,
						data.lineNumberWidth,
					)
					: mode === "compact"
						? renderCompact(
							data.entries,
							renderCtx,
						)
						: renderUnified(
							data.entries,
							renderCtx,
							data.lineNumberWidth,
						);

			const bodyWithLimit = applyLineLimit(
				bodyRows,
				safeWidth,
				options.expanded,
				config.diffCollapsedLines,
				config.expandedPreviewMaxLines,
				data.hunkCount,
				theme,
			);
			const frame = renderDiffFrameLine(safeWidth, theme);
			const renderedLines = mode === "unified"
				? [header, frame, ...bodyWithLimit, frame]
				: [header, ...bodyWithLimit];
			const finalLines = clampDiffLinesToWidth(renderedLines, safeWidth);
			return cache.set(safeWidth, options.expanded, mode, finalLines);
		},
		invalidate: cache.invalidate,
	};
}
