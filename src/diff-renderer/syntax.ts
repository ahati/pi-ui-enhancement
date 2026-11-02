import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { ANSI_SGR_PATTERN, toSgrParams } from "../ansi-utils.js";
import { sanitizeAnsiForThemedOutput } from "../render-utils.js";
import { createShikiDiffBlockHighlighter } from "../shiki-codeblock-renderer.js";
import type { ToolDisplayConfig } from "../types.js";
import type {
	CodeLineHighlighter,
	DiffLineEntry,
	DiffPalette,
	DiffSpan,
	DiffSyntaxOverride,
	DiffTheme,
	ParsedDiffEntry,
} from "./types.js";
import { getLineBackground } from "./palette.js";
import { applyInlineSpanHighlight } from "./inline.js";

export const DIFF_BLOCK_MAX_CHARS = 24000;
export const CONTEXT_DIM_ANSI = "\x1b[2m";

export function normalizeCodeWhitespace(text: string): string {
	return text.replace(/\t/g, "    ");
}

export function emphasis(theme: DiffTheme, text: string): string {
	return typeof theme.bold === "function" ? theme.bold(text) : text;
}

export function resolveLanguageFromPath(rawPath: string | undefined): string | undefined {
	if (!rawPath || !rawPath.trim()) {
		return undefined;
	}
	const normalizedPath = rawPath.replace(/^@/, "").trim();
	if (!normalizedPath) {
		return undefined;
	}
	try {
		return getLanguageFromPath(normalizedPath);
	} catch {
		return undefined;
	}
}

export function createCodeLineHighlighter(language: string | undefined): CodeLineHighlighter {
	if (!language) {
		return (line) => sanitizeAnsiForThemedOutput(line);
	}
	const cache = new Map<string, string>();
	return (line) => {
		if (!line) {
			return line;
		}
		const cached = cache.get(line);
		if (cached !== undefined) {
			return cached;
		}
		try {
			const highlighted = highlightCode(line, language)[0] ?? line;
			const sanitized = sanitizeAnsiForThemedOutput(highlighted);
			cache.set(line, sanitized);
			return sanitized;
		} catch {
			const sanitizedFallback = sanitizeAnsiForThemedOutput(line);
			cache.set(line, sanitizedFallback);
			return sanitizedFallback;
		}
	};
}

export function createDiffCodeHighlighter(language: string | undefined, config: ToolDisplayConfig): CodeLineHighlighter {
	if (config.diffSyntaxHighlighting === "off") {
		return (line) => sanitizeAnsiForThemedOutput(line);
	}
	return createCodeLineHighlighter(language);
}

export function applyContextDim(text: string): string {
	if (!text) {
		return text;
	}
	let output = CONTEXT_DIM_ANSI;
	let last = 0;
	ANSI_SGR_PATTERN.lastIndex = 0;
	for (let match = ANSI_SGR_PATTERN.exec(text); match !== null; match = ANSI_SGR_PATTERN.exec(text)) {
		output += text.slice(last, match.index) + match[0];
		const params = toSgrParams(match[1] ?? "");
		if (params.includes(0) || params.includes(22)) {
			output += CONTEXT_DIM_ANSI;
		}
		last = match.index + match[0].length;
	}
	output += text.slice(last);
	return output;
}

export function buildDiffSyntaxOverride(
	entries: ParsedDiffEntry[],
	language: string | undefined,
	config: ToolDisplayConfig,
	fallback: CodeLineHighlighter,
): DiffSyntaxOverride | undefined {
	const highlightBlock = createShikiDiffBlockHighlighter(language, config);
	if (!highlightBlock) {
		return undefined;
	}

	const overrides = new Map<DiffLineEntry, string>();
	let group: DiffLineEntry[] = [];

	const flushGroup = (): void => {
		if (group.length === 0) {
			return;
		}
		const oldLines: string[] = [];
		const newLines: string[] = [];
		for (const lineEntry of group) {
			const text = normalizeCodeWhitespace(lineEntry.content);
			if (lineEntry.lineKind === "add") {
				newLines.push(text);
			} else {
				oldLines.push(text);
			}
		}
		const oldHighlighted = oldLines.join("\n").length <= DIFF_BLOCK_MAX_CHARS
			? highlightBlock(oldLines.join("\n"))
			: undefined;
		const newHighlighted = newLines.join("\n").length <= DIFF_BLOCK_MAX_CHARS
			? highlightBlock(newLines.join("\n"))
			: undefined;
		let oldIndex = 0;
		let newIndex = 0;
		for (const lineEntry of group) {
			if (lineEntry.lineKind === "add") {
				const highlighted = newHighlighted?.[newIndex];
				if (highlighted !== undefined) {
					overrides.set(lineEntry, highlighted);
				}
				newIndex += 1;
			} else if (lineEntry.lineKind === "remove") {
				const highlighted = oldHighlighted?.[oldIndex];
				if (highlighted !== undefined) {
					overrides.set(lineEntry, highlighted);
				}
				oldIndex += 1;
			} else {
				const highlighted = oldHighlighted?.[oldIndex] ?? newHighlighted?.[newIndex];
				if (highlighted !== undefined) {
					overrides.set(lineEntry, highlighted);
				}
				oldIndex += 1;
				newIndex += 1;
			}
		}
		group = [];
	};

	for (const entry of entries) {
		if (entry.kind !== "line") {
			continue;
		}
		if (group.length > 0 && group[0].hunkIndex !== entry.hunkIndex) {
			flushGroup();
		}
		group.push(entry);
	}
	flushGroup();

	return (entry, codeText) => overrides.get(entry) ?? fallback(codeText);
}

export function highlightDiffLine(
	codeText: string,
	entry: DiffLineEntry,
	inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>,
	palette: DiffPalette,
	highlightLine: CodeLineHighlighter,
	containerBgAnsi: string | undefined,
	syntaxOverride?: DiffSyntaxOverride,
): { highlighted: string; rowBg: string | undefined } {
	const syntaxHighlighted = syntaxOverride ? syntaxOverride(entry, codeText) : highlightLine(codeText);
	const rowBg = getLineBackground(entry.lineKind, palette, false);
	const emphasisBg = getLineBackground(entry.lineKind, palette, true);
	const inlineSpans = inlineHighlights.get(entry) ?? [];
	const highlighted = applyInlineSpanHighlight(codeText, syntaxHighlighted, inlineSpans, emphasisBg, rowBg, containerBgAnsi);
	return { highlighted, rowBg };
}
