import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type DiffIndicatorMode, type ToolDisplayConfig } from "../types.js";
import type {
	DiffLineEntry,
	DiffLineKind,
	DiffTheme,
	LineCellRenderParams,
	RenderedRow,
} from "./types.js";
import {
	ANSI_BG_RESET,
	applyLineBackgroundToWrappedRows,
	keepBackgroundAcrossResets,
	stabilizeBackgroundResets,
	wrapToWidth,
} from "./palette.js";

export function resolveDiffIndicatorMode(config: Partial<Pick<ToolDisplayConfig, "diffIndicatorMode">>): DiffIndicatorMode {
	return config.diffIndicatorMode ?? DEFAULT_TOOL_DISPLAY_CONFIG.diffIndicatorMode;
}

export function resolveIndicatorGlyph(kind: DiffLineKind, indicatorMode: DiffIndicatorMode, continuation: boolean): string {
	if (kind === "context") {
		return " ";
	}

	switch (indicatorMode) {
		case "bars":
			return "▌";
		case "classic":
			if (continuation) {
				return " ";
			}
			return kind === "add" ? "+" : "-";
		case "none":
		default:
			return " ";
	}
}

export function colorizeSegment(
	theme: DiffTheme,
	color: "dim" | "toolDiffAdded" | "toolDiffRemoved",
	text: string,
	rowBg: string | undefined,
): string {
	let themedText: string;
	try {
		themedText = theme.fg(color, text);
	} catch {
		themedText = text;
	}

	if (!rowBg) {
		return themedText;
	}

	const stableText = keepBackgroundAcrossResets(themedText, rowBg);
	return `${rowBg}${stableText}${rowBg}`;
}

export function renderChangeMarker(
	kind: DiffLineKind,
	theme: DiffTheme,
	rowBg: string | undefined,
	indicatorMode: DiffIndicatorMode,
	continuation = false,
): string {
	const glyph = resolveIndicatorGlyph(kind, indicatorMode, continuation);
	if (glyph === " ") {
		return rowBg ? `${rowBg} ${rowBg}` : " ";
	}
	if (kind === "add") {
		return colorizeSegment(theme, "toolDiffAdded", glyph, rowBg);
	}
	if (kind === "remove") {
		return colorizeSegment(theme, "toolDiffRemoved", glyph, rowBg);
	}
	return colorizeSegment(theme, "dim", glyph, rowBg);
}

export function usesHashlineGutter(showHashlineAnchors: boolean): boolean {
	return showHashlineAnchors;
}

export function getHashlineGutterMarkerWidth(_indicatorMode: DiffIndicatorMode): number {
	return 0;
}

export function getLineDividerPlainWidth(indicatorMode: DiffIndicatorMode, hashlineGutter = false): number {
	if (hashlineGutter) {
		return 2;
	}
	return indicatorMode === "classic" ? 1 : 2;
}

export function renderCodeDivider(
	theme: DiffTheme,
	rowBg: string | undefined,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter = false,
): string {
	return colorizeSegment(theme, "dim", hashlineGutter || indicatorMode !== "classic" ? "│ " : "│", rowBg);
}

export function getLineNumberColor(kind: DiffLineKind): "dim" | "toolDiffAdded" | "toolDiffRemoved" {
	if (kind === "add") {
		return "toolDiffAdded";
	}
	if (kind === "remove") {
		return "toolDiffRemoved";
	}
	return "dim";
}

export function renderLineNumberSegment(
	kind: DiffLineKind,
	lineNumber: string,
	theme: DiffTheme,
	rowBg: string | undefined,
): string {
	return colorizeSegment(theme, getLineNumberColor(kind), lineNumber, rowBg);
}

export function getLinePrefixPlainWidth(lineNumberWidth: number, indicatorMode: DiffIndicatorMode, hashlineGutter = false): number {
	if (hashlineGutter) {
		return getHashlineGutterMarkerWidth(indicatorMode) + lineNumberWidth;
	}
	return indicatorMode === "bars"
		? visibleWidth(`▌ ${" ".repeat(lineNumberWidth)} `)
		: visibleWidth(`${" ".repeat(lineNumberWidth)} `);
}

export function getLineContentIndicatorPrefixPlainWidth(indicatorMode: DiffIndicatorMode): number {
	return indicatorMode === "classic" ? 2 : 0;
}

export function renderClassicContentPrefix(
	kind: DiffLineKind,
	theme: DiffTheme,
	rowBg: string | undefined,
	continuation = false,
): string {
	if (kind === "context" || continuation) {
		return rowBg ? `${rowBg}  ${rowBg}` : "  ";
	}

	const glyph = kind === "add" ? "+" : "-";
	const glyphColor = kind === "add" ? "toolDiffAdded" : "toolDiffRemoved";
	const spacer = rowBg ? `${rowBg} ` : " ";
	return `${colorizeSegment(theme, glyphColor, glyph, rowBg)}${spacer}`;
}

export function renderLinePrefix(
	kind: DiffLineKind,
	lineNumber: string,
	theme: DiffTheme,
	rowBg: string | undefined,
	indicatorMode: DiffIndicatorMode,
	continuation = false,
	hashlineGutter = false,
): string {
	const number = renderLineNumberSegment(kind, lineNumber, theme, rowBg);
	if (hashlineGutter) {
		return number;
	}
	const spacer = rowBg ? `${rowBg} ` : " ";
	if (indicatorMode !== "bars") {
		return `${number}${spacer}`;
	}
	const marker = renderChangeMarker(kind, theme, rowBg, indicatorMode, continuation);
	return `${marker}${spacer}${number}${spacer}`;
}

export function renderLineContinuationPrefix(
	kind: DiffLineKind,
	lineNumberWidth: number,
	rowBg: string | undefined,
	theme: DiffTheme,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter = false,
): string {
	const blankLineNumber = " ".repeat(lineNumberWidth);
	return renderLinePrefix(kind, blankLineNumber, theme, rowBg, indicatorMode, true, hashlineGutter);
}

export function renderLineContentIndicatorPrefix(
	kind: DiffLineKind,
	theme: DiffTheme,
	rowBg: string | undefined,
	indicatorMode: DiffIndicatorMode,
	continuation = false,
): string {
	return indicatorMode === "classic"
		? renderClassicContentPrefix(kind, theme, rowBg, continuation)
		: "";
}

export function renderCompactLinePrefix(
	kind: DiffLineKind,
	theme: DiffTheme,
	rowBg: string | undefined,
	indicatorMode: DiffIndicatorMode,
	continuation = false,
): string {
	const marker = renderChangeMarker(kind, theme, rowBg, indicatorMode, continuation);
	const spacer = rowBg ? `${rowBg} ` : " ";
	return `${marker}${spacer}`;
}

export function computeLineCellCodeWidth(
	width: number,
	lineNumberWidth: number,
	indicatorMode: DiffIndicatorMode,
	hashlineGutter: boolean,
): number {
	const prefixPlainWidth = getLinePrefixPlainWidth(lineNumberWidth, indicatorMode, hashlineGutter);
	const dividerPlainWidth = getLineDividerPlainWidth(indicatorMode, hashlineGutter);
	const contentIndicatorWidth = hashlineGutter ? 0 : getLineContentIndicatorPrefixPlainWidth(indicatorMode);
	return Math.max(0, width - prefixPlainWidth - dividerPlainWidth - contentIndicatorWidth);
}

export function buildLineCellParams(
	kind: DiffLineKind,
	code: string,
	width: number,
	rowBg: string | undefined,
	restoreBgAnsi: string | undefined,
	theme: DiffTheme,
	wordWrap: boolean,
	indicatorMode: DiffIndicatorMode,
): LineCellRenderParams {
	return { kind, code, width, rowBg, restoreBgAnsi, theme, wordWrap, indicatorMode };
}

export function renderWrappedRowsWithOptionalBackground(
	wrappedCodeLines: string[],
	buildRow: (index: number, wrappedCodeLine: string) => string,
	width: number,
	rowBg: string | undefined,
	restoreBgAnsi: string | undefined,
): string[] {
	if (!rowBg) {
		return wrappedCodeLines.map((wrappedCodeLine, index) =>
			stabilizeBackgroundResets(buildRow(index, wrappedCodeLine)),
		);
	}
	const safeRestoreBgAnsi = restoreBgAnsi ?? rowBg ?? ANSI_BG_RESET;
	const visualRows = wrappedCodeLines.map((wrappedCodeLine, index) => buildRow(index, wrappedCodeLine));
	return applyLineBackgroundToWrappedRows(visualRows, width, rowBg, safeRestoreBgAnsi);
}

export function renderCompactLineCell({ kind, code, width, rowBg, restoreBgAnsi, theme, wordWrap, indicatorMode }: LineCellRenderParams): string[] {
	if (width <= 0) {
		return [""];
	}

	const prefix = renderCompactLinePrefix(kind, theme, undefined, indicatorMode);
	const continuationPrefix = renderCompactLinePrefix(kind, theme, undefined, indicatorMode, true);
	const prefixPlainWidth = 2;
	const codeWidth = Math.max(0, width - prefixPlainWidth);
	const wrappedCodeLines = wrapToWidth(code, codeWidth, wordWrap);
	return renderWrappedRowsWithOptionalBackground(
		wrappedCodeLines,
		(index, line) => `${index === 0 ? prefix : continuationPrefix}${line}`,
		width,
		rowBg,
		restoreBgAnsi,
	);
}

export function renderLineCell(
	{ kind, code, width, rowBg, restoreBgAnsi, theme, wordWrap, indicatorMode }: LineCellRenderParams,
	lineNumber: string,
	hashlineGutter = false,
): string[] {
	if (width <= 0) {
		return [""];
	}

	const codeWidth = computeLineCellCodeWidth(width, lineNumber.length, indicatorMode, hashlineGutter);
	const prefix = renderLinePrefix(kind, lineNumber, theme, undefined, indicatorMode, false, hashlineGutter);
	const continuationPrefix = renderLineContinuationPrefix(kind, lineNumber.length, undefined, theme, indicatorMode, hashlineGutter);
	const divider = renderCodeDivider(theme, undefined, indicatorMode, hashlineGutter);
	const firstContentPrefix = hashlineGutter ? "" : renderLineContentIndicatorPrefix(kind, theme, undefined, indicatorMode);
	const continuationContentPrefix = hashlineGutter ? "" : renderLineContentIndicatorPrefix(kind, theme, undefined, indicatorMode, true);
	const wrappedCodeLines = wrapToWidth(code, codeWidth, wordWrap);
	return renderWrappedRowsWithOptionalBackground(
		wrappedCodeLines,
		(index, line) => {
			const linePrefix = index === 0 ? prefix : continuationPrefix;
			const contentPrefix = index === 0 ? firstContentPrefix : continuationContentPrefix;
			return `${linePrefix}${divider}${contentPrefix}${line}`;
		},
		width,
		rowBg,
		restoreBgAnsi,
	);
}

export function pushDiffLineRows(rows: RenderedRow[], lines: string[], entry: DiffLineEntry): void {
	rows.push(
		...lines.map((text) => ({
			text,
			hunkIndex: entry.hunkIndex || null,
		})),
	);
}
