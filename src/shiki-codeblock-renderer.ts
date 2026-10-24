import {
	Markdown,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { createHighlighterCoreSync, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import dockerfile from "shiki/langs/dockerfile.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsonc from "shiki/langs/jsonc.mjs";
import jsx from "shiki/langs/jsx.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import markdown from "shiki/langs/markdown.mjs";
import php from "shiki/langs/php.mjs";
import python from "shiki/langs/python.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import scss from "shiki/langs/scss.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import svelte from "shiki/langs/svelte.mjs";
import swift from "shiki/langs/swift.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import vue from "shiki/langs/vue.mjs";
import xml from "shiki/langs/xml.mjs";
import yaml from "shiki/langs/yaml.mjs";
import darkPlus from "shiki/themes/dark-plus.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import lightPlus from "shiki/themes/light-plus.mjs";
import minDark from "shiki/themes/min-dark.mjs";
import minLight from "shiki/themes/min-light.mjs";
import oneDarkPro from "shiki/themes/one-dark-pro.mjs";
import vitesseDark from "shiki/themes/vitesse-dark.mjs";
import vitesseLight from "shiki/themes/vitesse-light.mjs";
import { registerCleanup } from "./disposable.js";
import {
	DEFAULT_TOOL_DISPLAY_CONFIG,
	SHIKI_CODE_BLOCK_THEMES,
	type ShikiCodeBlockTheme,
	type ToolDisplayConfig,
} from "./types.js";

interface MarkdownThemeLike {
	codeBlock(text: string): string;
	codeBlockBorder(text: string): string;
	codeBlockIndent?: string;
	highlightCode?: (code: string, lang?: string) => string[];
}

interface MarkdownInstanceLike {
	theme: MarkdownThemeLike;
	renderToken: RenderTokenFunction;
}

interface MarkdownCodeTokenLike {
	type: string;
	text?: string;
	lang?: string;
}

type RenderTokenFunction = (
	this: MarkdownInstanceLike,
	token: unknown,
	width: number,
	nextTokenType?: string,
	styleContext?: unknown,
) => string[];

type ConfigGetter = () => ToolDisplayConfig;

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const FONT_STYLE_STRIKETHROUGH = 8;
const SHIKI_MARKDOWN_PATCH_VERSION = 1;
const PATCH_KEY = Symbol.for("pi-render.markdownShikiPatch.v1");
const PLAIN_TEXT_LANGUAGES = new Set(["", "text", "txt", "plain", "plaintext", "console", "ansi"]);
const LANGUAGE_ALIASES: Record<string, string> = {
	cjs: "javascript",
	cts: "typescript",
	docker: "dockerfile",
	htm: "html",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	ps1: "shellscript",
	py: "python",
	sh: "bash",
	shell: "bash",
	yml: "yaml",
	zsh: "bash",
};

const THEME_FALLBACK: ShikiCodeBlockTheme = DEFAULT_TOOL_DISPLAY_CONFIG.shikiCodeBlockTheme;

interface PatchedMarkdownPrototype {
	[PATCH_KEY]?: {
		version: number;
		originalRenderToken: RenderTokenFunction;
	};
	renderToken?: RenderTokenFunction;
}

let highlighter: HighlighterCore | undefined;
let highlighterFailed = false;
let activeConfigGetter: ConfigGetter = () => DEFAULT_TOOL_DISPLAY_CONFIG;

function getHighlighter(): HighlighterCore | undefined {
	if (highlighter || highlighterFailed) {
		return highlighter;
	}

	try {
		highlighter = createHighlighterCoreSync({
			engine: createJavaScriptRegexEngine(),
			themes: [
				darkPlus,
				githubDark,
				githubLight,
				lightPlus,
				minDark,
				minLight,
				oneDarkPro,
				vitesseDark,
				vitesseLight,
			],
			langs: [
				bash,
				c,
				cpp,
				csharp,
				css,
				diff,
				dockerfile,
				go,
				html,
				java,
				javascript,
				json,
				jsonc,
				jsx,
				kotlin,
				markdown,
				php,
				python,
				ruby,
				rust,
				scss,
				shellscript,
				sql,
				svelte,
				swift,
				toml,
				tsx,
				typescript,
				vue,
				xml,
				yaml,
			],
		});
	} catch {
		highlighterFailed = true;
	}

	return highlighter;
}

function isKnownShikiTheme(theme: unknown): theme is ShikiCodeBlockTheme {
	return SHIKI_CODE_BLOCK_THEMES.includes(theme as ShikiCodeBlockTheme);
}

function getShikiTheme(config: ToolDisplayConfig): ShikiCodeBlockTheme {
	return isKnownShikiTheme(config.shikiCodeBlockTheme)
		? config.shikiCodeBlockTheme
		: THEME_FALLBACK;
}

function normalizeLanguage(rawLanguage: unknown): string | undefined {
	if (typeof rawLanguage !== "string") {
		return undefined;
	}

	const firstWord = rawLanguage
		.trim()
		.split(/\s+/, 1)[0]
		?.replace(/^language-/i, "")
		.toLowerCase()
		.trim() ?? "";

	if (PLAIN_TEXT_LANGUAGES.has(firstWord)) {
		return undefined;
	}

	return LANGUAGE_ALIASES[firstWord] ?? firstWord;
}

function ansiColor(hexColor: string | undefined): string {
	if (!hexColor) {
		return "";
	}

	const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hexColor.trim());
	if (!match) {
		return "";
	}

	const value = match[1];
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	if ([r, g, b].some((channel) => Number.isNaN(channel))) {
		return "";
	}

	return `\x1b[38;2;${r};${g};${b}m`;
}

function ansiStyle(fontStyle: number | undefined): string {
	if (!fontStyle || fontStyle < 0) {
		return "";
	}

	let style = "";
	if ((fontStyle & FONT_STYLE_BOLD) !== 0) style += "\x1b[1m";
	if ((fontStyle & FONT_STYLE_ITALIC) !== 0) style += "\x1b[3m";
	if ((fontStyle & FONT_STYLE_UNDERLINE) !== 0) style += "\x1b[4m";
	if ((fontStyle & FONT_STYLE_STRIKETHROUGH) !== 0) style += "\x1b[9m";
	return style;
}

function styleToken(token: ThemedToken, theme: MarkdownThemeLike): string {
	const prefix = `${ansiStyle(token.fontStyle)}${ansiColor(token.color)}`;
	if (!prefix) {
		return theme.codeBlock(token.content);
	}
	return `${prefix}${token.content}\x1b[0m`;
}

/**
 * Exported for tests: cache identity (same array reference on repeat renders)
 * is how the tests prove the memoization actually short-circuits.
 */
export function renderShikiLines(
	code: string,
	lang: string | undefined,
	config: ToolDisplayConfig,
	theme: MarkdownThemeLike,
): string[] | undefined {
	if (!config.enableShikiCodeBlocks || !lang) {
		return undefined;
	}

	const shiki = getHighlighter();
	if (!shiki) {
		return undefined;
	}

	// The TUI re-renders unchanged fences on every keystroke; memoize per theme
	// instance so repeat renders skip tokenization. Keyed weakly by the theme
	// object (styleToken output depends on theme.codeBlock, so a new theme
	// instance must never reuse entries) and by shiki theme name + lang + code
	// inside. Failures are cached too: an unsupported grammar would otherwise
	// re-throw on every render of the same fence.
	const cacheable = code.length <= FENCE_HIGHLIGHT_MAX_CHARS && typeof theme === "object" && theme !== null;
	const shikiTheme = getShikiTheme(config);
	const cacheKey = `${shikiTheme}\0${lang}\0${code}`;
	const themeCache = cacheable ? fenceHighlightCache.get(theme) : undefined;
	if (themeCache?.has(cacheKey)) {
		return themeCache.get(cacheKey);
	}

	let result: string[] | undefined;
	try {
		const resolvedLang = shiki.resolveLangAlias(lang);
		const tokens = shiki.codeToTokensBase(code, {
			lang: resolvedLang,
			theme: shikiTheme,
		});
		result = tokens.map((lineTokens) => {
			if (lineTokens.length === 0) {
				return "";
			}
			return lineTokens.map((token) => styleToken(token, theme)).join("");
		});
	} catch {
		result = undefined;
	}

	if (cacheable) {
		let cache = fenceHighlightCache.get(theme);
		if (!cache) {
			cache = new Map();
			fenceHighlightCache.set(theme, cache);
		}
		if (cache.size >= FENCE_HIGHLIGHT_CACHE_LIMIT) {
			cache.clear();
		}
		cache.set(cacheKey, result);
	}

	return result;
}

function renderFallbackHighlightedLines(
	code: string,
	lang: string | undefined,
	theme: MarkdownThemeLike,
): string[] {
	if (theme.highlightCode) {
		try {
			return theme.highlightCode(code, lang);
		} catch {
			// Fall through to plain code block styling.
		}
	}

	return code.split("\n").map((line) => theme.codeBlock(line));
}

export type ShikiDiffBlockHighlighter = (code: string) => string[] | undefined;

const DIFF_BLOCK_MAX_CHARS = 24000;
const DIFF_HIGHLIGHT_CACHE_LIMIT = 128;
const diffBlockHighlightCache = new Map<string, string[] | undefined>();

// Cache budget for whole-fence highlight results (see renderShikiLines). Capped
// at the same per-input size as diff blocks; entry count is small because the
// working set is "fences currently visible in the transcript".
const FENCE_HIGHLIGHT_MAX_CHARS = DIFF_BLOCK_MAX_CHARS;
const FENCE_HIGHLIGHT_CACHE_LIMIT = 64;
const fenceHighlightCache = new WeakMap<object, Map<string, string[] | undefined>>();

function styleDiffToken(token: ThemedToken): string {
	const color = ansiColor(token.color);
	const italic = ((token.fontStyle ?? 0) & FONT_STYLE_ITALIC) !== 0;
	const prefix = `${color}${italic ? "\x1b[3m" : ""}`;
	if (!prefix) {
		return token.content;
	}
	// Foreground-only resets (39/23) keep diff row backgrounds and the context-row
	// dim alive. Bold is dropped deliberately: SGR 22 would clear the dim.
	return `${prefix}${token.content}\x1b[39m${italic ? "\x1b[23m" : ""}`;
}

/**
 * Block-level Shiki highlighter for edit/write diffs. The whole block is
 * highlighted at once so multi-line grammar state (template literals, block
 * comments, JSX) is preserved, unlike per-line cli-highlight. Returns per-line
 * ANSI strings, or undefined when Shiki cannot handle the block (unknown
 * language, oversized input) so the caller can fall back.
 */
export function createShikiDiffBlockHighlighter(
	rawLanguage: string | undefined,
	config: ToolDisplayConfig,
): ShikiDiffBlockHighlighter | undefined {
	const lang = normalizeLanguage(rawLanguage);
	if (!lang || config.diffSyntaxHighlighting !== "shiki") {
		return undefined;
	}
	const shikiTheme = getShikiTheme(config);

	return (code: string): string[] | undefined => {
		if (!code) {
			return undefined;
		}
		const cacheKey = `${shikiTheme}\0${lang}\0${code}`;
		if (diffBlockHighlightCache.has(cacheKey)) {
			return diffBlockHighlightCache.get(cacheKey);
		}

		let result: string[] | undefined;
		const shiki = getHighlighter();
		if (shiki && code.length <= DIFF_BLOCK_MAX_CHARS) {
			try {
				const resolvedLang = shiki.resolveLangAlias(lang);
				const tokens = shiki.codeToTokensBase(code, {
					lang: resolvedLang,
					theme: shikiTheme,
				});
				result = tokens.map((lineTokens) => lineTokens.map(styleDiffToken).join(""));
			} catch {
				result = undefined;
			}
		}

		if (diffBlockHighlightCache.size >= DIFF_HIGHLIGHT_CACHE_LIMIT) {
			diffBlockHighlightCache.clear();
		}
		diffBlockHighlightCache.set(cacheKey, result);
		return result;
	};
}

function renderHighlightedLines(
	code: string,
	lang: string | undefined,
	config: ToolDisplayConfig,
	theme: MarkdownThemeLike,
): string[] {
	return renderShikiLines(code, lang, config, theme)
		?? renderFallbackHighlightedLines(code, lang, theme);
}

function buildBorderLine(
	left: string,
	right: string,
	width: number,
	theme: MarkdownThemeLike,
	label?: string,
): string {
	const safeWidth = Math.max(2, Math.floor(width));
	const cleanLabel = label?.trim();
	// Reserve room for both corners plus one space of padding around the label so
	// the right corner (╮/╯) always survives, even with long language tags.
	const maxLabelWidth = Math.max(0, safeWidth - 4);
	const fittedLabel = cleanLabel ? truncateToWidth(cleanLabel, maxLabelWidth, "…") : "";
	const labelText = fittedLabel ? ` ${fittedLabel} ` : "";
	const availableFillWidth = Math.max(0, safeWidth - 2 - visibleWidth(labelText));
	return theme.codeBlockBorder(`${left}${labelText}${"─".repeat(availableFillWidth)}${right}`);
}

function renderFormattedCodeBlock(
	lines: string[],
	languageLabel: string | undefined,
	width: number,
	theme: MarkdownThemeLike,
): string[] {
	// Layout: │ <code padded to codeArea> │  → the right border is always drawn.
	const codeArea = Math.max(1, Math.floor(width) - 4);
	const rows: string[] = [];
	for (const line of lines) {
		const visualRows = visibleWidth(line) <= codeArea
			? [line]
			: wrapTextWithAnsi(line, codeArea);
		for (const visualRow of visualRows) {
			const padding = Math.max(0, codeArea - visibleWidth(visualRow));
			rows.push(`${theme.codeBlockBorder("│")} ${visualRow}${" ".repeat(padding)} ${theme.codeBlockBorder("│")}`);
		}
	}
	if (rows.length === 0) {
		rows.push(`${theme.codeBlockBorder("│")}${" ".repeat(codeArea + 2)}${theme.codeBlockBorder("│")}`);
	}
	return [
		buildBorderLine("╭", "╮", width, theme, languageLabel),
		...rows,
		buildBorderLine("╰", "╯", width, theme),
	];
}

function renderFenceCodeBlock(
	lines: string[],
	languageLabel: string | undefined,
	theme: MarkdownThemeLike,
): string[] {
	const indent = theme.codeBlockIndent ?? "  ";
	return [
		theme.codeBlockBorder(`\`\`\`${languageLabel ?? ""}`),
		...lines.map((line) => `${indent}${line}`),
		theme.codeBlockBorder("```")
	];
}

function renderCodeToken(
	token: MarkdownCodeTokenLike,
	width: number,
	nextTokenType: string | undefined,
	config: ToolDisplayConfig,
	theme: MarkdownThemeLike,
): string[] {
	const rawCode = typeof token.text === "string" ? token.text : "";
	const rawLanguage = typeof token.lang === "string" ? token.lang : undefined;
	const lang = normalizeLanguage(rawLanguage);
	const highlightedLines = renderHighlightedLines(rawCode, lang, config, theme);
	const languageLabel = rawLanguage?.trim().split(/\s+/, 1)[0] || lang;
	const lines = config.formatCodeBlocks
		? renderFormattedCodeBlock(highlightedLines, languageLabel, width, theme)
		: renderFenceCodeBlock(highlightedLines, languageLabel, theme);

	if (nextTokenType && nextTokenType !== "space") {
		lines.push("");
	}

	return lines;
}

function isCodeToken(token: unknown): token is MarkdownCodeTokenLike {
	return !!token
		&& typeof token === "object"
		&& (token as MarkdownCodeTokenLike).type === "code";
}

function registerMarkdownPatchCleanup(
	prototype: PatchedMarkdownPrototype,
	originalRenderToken: RenderTokenFunction,
): void {
	registerCleanup(() => {
		const current = prototype[PATCH_KEY];
		if (current?.originalRenderToken === originalRenderToken) {
			prototype.renderToken = originalRenderToken;
			delete prototype[PATCH_KEY];
		}
	});
}

export function registerShikiCodeBlockRenderer(getConfig: ConfigGetter): void {
	activeConfigGetter = getConfig;

	const prototype = Markdown.prototype as unknown as PatchedMarkdownPrototype;
	const alreadyPatched = prototype[PATCH_KEY];
	if (alreadyPatched?.version === SHIKI_MARKDOWN_PATCH_VERSION) {
		registerMarkdownPatchCleanup(prototype, alreadyPatched.originalRenderToken);
		return;
	}

	const originalRenderToken = alreadyPatched?.originalRenderToken ?? prototype.renderToken;
	if (typeof originalRenderToken !== "function") {
		return;
	}

	prototype.renderToken = function renderTokenWithShikiCodeBlocks(
		this: MarkdownInstanceLike,
		token: unknown,
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	): string[] {
		const config = activeConfigGetter();
		if (isCodeToken(token) && (config.enableShikiCodeBlocks || config.formatCodeBlocks)) {
			try {
				return renderCodeToken(token, width, nextTokenType, config, this.theme);
			} catch {
				return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
			}
		}

		return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
	};

	prototype[PATCH_KEY] = {
		version: SHIKI_MARKDOWN_PATCH_VERSION,
		originalRenderToken,
	};

	registerMarkdownPatchCleanup(prototype, originalRenderToken);
}
