import type { ToolDisplayConfig, DiffIndicatorMode } from "../types.js";

export interface DiffTheme {
	fg(color: string, text: string): string;
	bg?(color: string, text: string): string;
	bold?(text: string): string;
	getFgAnsi?(color: string): string;
	getBgAnsi?(color: string): string;
}

export type DiffLineKind = "add" | "remove" | "context";
export type DiffEntryKind = "line" | "meta" | "hunk" | "file";

export interface DiffLineEntry {
	kind: "line";
	lineKind: DiffLineKind;
	oldLineNumber: number | null;
	newLineNumber: number | null;
	fallbackLineNumber: string;
	content: string;
	hashlineAnchorContent?: string;
	raw: string;
	hunkIndex: number;
}

export interface DiffMetaEntry {
	kind: Exclude<DiffEntryKind, "line">;
	raw: string;
	hunkIndex: number;
}

export type ParsedDiffEntry = DiffLineEntry | DiffMetaEntry;

export interface DiffStats {
	added: number;
	removed: number;
	context: number;
	hunks: number;
	files: number;
	lines: number;
}

export interface ParsedDiff {
	entries: ParsedDiffEntry[];
	stats: DiffStats;
}

export interface RenderedRow {
	text: string;
	hunkIndex: number | null;
}

export interface SplitDiffRow {
	left?: DiffLineEntry;
	right?: DiffLineEntry;
	meta?: DiffMetaEntry;
	hunkIndex: number | null;
}

export interface DiffSpan {
	start: number;
	end: number;
}

export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

export interface DiffPalette {
	addRowBgAnsi: string;
	removeRowBgAnsi: string;
	addEmphasisBgAnsi: string;
	removeEmphasisBgAnsi: string;
}

export interface DiffRenderOptions {
	expanded: boolean;
	filePath?: string;
	previousContent?: string;
	fileExistedBeforeWrite?: boolean;
	headerLabel?: string;
}

export type CodeLineHighlighter = (line: string) => string;
export type DiffSyntaxOverride = (entry: DiffLineEntry, codeText: string) => string;

export interface LineCellRenderParams {
	kind: DiffLineKind;
	code: string;
	width: number;
	rowBg: string | undefined;
	restoreBgAnsi: string | undefined;
	theme: DiffTheme;
	wordWrap: boolean;
	indicatorMode: DiffIndicatorMode;
}

export interface DiffRenderContext {
	width: number;
	theme: DiffTheme;
	inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>;
	palette: DiffPalette;
	highlightLine: CodeLineHighlighter;
	syntaxOverride?: DiffSyntaxOverride;
	containerBgAnsi: string | undefined;
	wordWrap: boolean;
	indicatorMode: DiffIndicatorMode;
	showHashlineAnchors: boolean;
}

export type WriteDiffOperationKind = "context" | "remove" | "add";

export interface WriteDiffOperation {
	kind: WriteDiffOperationKind;
	content: string;
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
