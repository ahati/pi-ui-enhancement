import { Text, type Component } from "@earendil-works/pi-tui";
import {
	buildDiffSummaryText,
	normalizeDiffRenderWidth,
	resolveDiffPresentationMode,
} from "./diff-presentation.js";
import { resolveDiffIndicatorMode } from "./diff-renderer/cells.js";
import { buildInlineHighlightMap } from "./diff-renderer/inline.js";
import {
	applyLineLimit,
	buildSplitRows,
	canRenderSplitLayout,
	createDiffRenderCache,
	renderCompact,
	renderDiffFrameLine,
	renderHeaderRows,
	renderSingleDiffRow,
	renderSplit,
	renderUnified,
} from "./diff-renderer/layouts.js";
import {
	ADD_INLINE_EMPHASIS_MIX_RATIO,
	ADD_ROW_BACKGROUND_MIX_RATIO,
	ADDITION_TINT_TARGET,
	DELETION_TINT_TARGET,
	REMOVE_INLINE_EMPHASIS_MIX_RATIO,
	REMOVE_ROW_BACKGROUND_MIX_RATIO,
	clampDiffLinesToWidth,
	resolveContainerBackgroundAnsi,
	resolveDiffPalette,
} from "./diff-renderer/palette.js";
import { getLineNumberWidth, parseDiff } from "./diff-renderer/parser.js";
import {
	buildDiffSyntaxOverride,
	createDiffCodeHighlighter,
	resolveLanguageFromPath,
} from "./diff-renderer/syntax.js";
import type {
	DiffRenderContext,
	DiffRenderOptions,
	DiffTheme,
	ParsedDiff,
} from "./diff-renderer/types.js";
import { renderWriteDiffResult } from "./diff-renderer/write-diff.js";
import type { ToolDisplayConfig } from "./types.js";

export {
	ADD_INLINE_EMPHASIS_MIX_RATIO,
	ADD_ROW_BACKGROUND_MIX_RATIO,
	ADDITION_TINT_TARGET,
	DELETION_TINT_TARGET,
	REMOVE_INLINE_EMPHASIS_MIX_RATIO,
	REMOVE_ROW_BACKGROUND_MIX_RATIO,
};
export { renderWriteDiffResult };
export type { DiffRenderOptions, DiffTheme } from "./diff-renderer/types.js";

interface EditToolDetails {
	diff?: string;
}

function safeGetDiff(details: unknown): string {
	if (!details || typeof details !== "object") {
		return "";
	}
	const typed = details as Partial<EditToolDetails>;
	return typeof typed.diff === "string" ? typed.diff : "";
}

export function renderEditDiffResult(
	details: unknown,
	options: DiffRenderOptions,
	config: ToolDisplayConfig,
	theme: DiffTheme,
	fallbackText: string,
): Component {
	const diffText = safeGetDiff(details);
	if (!diffText.trim()) {
		if (!fallbackText.trim()) {
			return new Text(theme.fg("muted", "↳ edit completed (no diff payload)"), 0, 0);
		}
		return new Text(theme.fg("toolOutput", fallbackText), 0, 0);
	}

	let parsed: ParsedDiff;
	try {
		parsed = parseDiff(diffText);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return new Text(theme.fg("warning", `↳ unable to render diff: ${message}`), 0, 0);
	}

	if (parsed.entries.length === 0) {
		return new Text(theme.fg("muted", "↳ no diff data"), 0, 0);
	}

	const splitRows = buildSplitRows(parsed.entries);
	const showHashlineAnchors = options.expanded === true
		&& parsed.entries.some((entry) => entry.kind === "line" && !!entry.hashlineAnchorContent);
	const lineNumberWidth = getLineNumberWidth(parsed.entries, showHashlineAnchors);
	const palette = resolveDiffPalette(theme, config);
	const containerBgAnsi = resolveContainerBackgroundAnsi(theme);
	const language = resolveLanguageFromPath(options.filePath);
	const highlightLine = createDiffCodeHighlighter(language, config);
	const syntaxOverride = buildDiffSyntaxOverride(parsed.entries, language, config, highlightLine);
	const wordWrap = config.diffWordWrap;
	const indicatorMode = resolveDiffIndicatorMode(config);

	const cache = createDiffRenderCache();

	return {
		render(width: number): string[] {
			const safeWidth = normalizeDiffRenderWidth(width);
			const mode = resolveDiffPresentationMode(config, safeWidth, canRenderSplitLayout(safeWidth));
			const cached = cache.get(safeWidth, options.expanded, mode);
			if (cached) {
				return cached;
			}

			if (mode === "summary") {
				return cache.set(
					safeWidth,
					options.expanded,
					mode,
					clampDiffLinesToWidth(
						renderSingleDiffRow(buildDiffSummaryText(parsed.stats, safeWidth), "toolOutput", safeWidth, theme),
						safeWidth,
					),
				);
			}

			const headerRows = renderHeaderRows(parsed.stats, mode, safeWidth, theme);
			const inlineHighlights = buildInlineHighlightMap(splitRows);
			const renderCtx: DiffRenderContext = {
				width: safeWidth,
				theme,
				inlineHighlights,
				palette,
				highlightLine,
				syntaxOverride,
				containerBgAnsi,
				wordWrap,
				indicatorMode,
				showHashlineAnchors,
			};

			const bodyRows = mode === "split"
				? renderSplit(splitRows, renderCtx, lineNumberWidth)
				: mode === "compact"
					? renderCompact(parsed.entries, renderCtx)
					: renderUnified(parsed.entries, renderCtx, lineNumberWidth);

			const bodyWithLimit = applyLineLimit(
				bodyRows,
				safeWidth,
				options.expanded,
				config.diffCollapsedLines,
				config.expandedPreviewMaxLines,
				parsed.stats.hunks,
				theme,
			);
			const frame = renderDiffFrameLine(safeWidth, theme);
			const renderedLines = mode === "unified"
				? [...headerRows.map((row) => row.text), frame, ...bodyWithLimit, frame]
				: [...headerRows.map((row) => row.text), ...bodyWithLimit];

			const clampedLines = clampDiffLinesToWidth(renderedLines, safeWidth);
			return cache.set(safeWidth, options.expanded, mode, clampedLines);
		},
		invalidate: cache.invalidate,
	};
}
