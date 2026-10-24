import assert from "node:assert/strict";
import test from "node:test";
import { Markdown } from "@earendil-works/pi-tui";
import { registerShikiCodeBlockRenderer, renderShikiLines } from "../src/shiki-codeblock-renderer.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";

const identity = (text: string): string => text;

function minimalTheme(): {
	codeBlock(text: string): string;
	codeBlockBorder(text: string): string;
} {
	return { codeBlock: identity, codeBlockBorder: identity };
}

function shikiConfig(overrides: Partial<ToolDisplayConfig> = {}): ToolDisplayConfig {
	return { ...DEFAULT_TOOL_DISPLAY_CONFIG, ...overrides };
}

const config = shikiConfig({ enableShikiCodeBlocks: true, shikiCodeBlockTheme: "github-dark" });
const CODE = "const x = 1;\nconst y = { z: 2 };";

test("repeat render of an unchanged fence returns the cached array reference", () => {
	const theme = minimalTheme();
	const first = renderShikiLines(CODE, "ts", config, theme);
	assert.ok(first, "expected shiki output for ts code");

	const second = renderShikiLines(CODE, "ts", config, theme);
	assert.strictEqual(second, first, "second render must short-circuit to the cached array, not re-tokenize");
});

test("a new theme instance never reuses entries, even with identical config", () => {
	const themeA = minimalTheme();
	const themeB = minimalTheme();
	const a = renderShikiLines(CODE, "ts", config, themeA);
	const b = renderShikiLines(CODE, "ts", config, themeB);

	assert.ok(a && b);
	assert.notStrictEqual(b, a, "different theme objects must not share cache entries");
	assert.deepEqual(b, a, "but identical inputs must still produce identical content");
});

test("caching is disabled above the size budget", () => {
	const theme = minimalTheme();
	const big = `const pad = "${"a".repeat(24_001)}";`;
	const first = renderShikiLines(big, "js", config, theme);
	const second = renderShikiLines(big, "js", config, theme);

	assert.ok(first && second);
	assert.notStrictEqual(second, first, "oversized fences must re-render, never sit in the cache");
});

test("unsupported grammars return undefined on every render", () => {
	const theme = minimalTheme();
	assert.equal(renderShikiLines(CODE, "definitely-not-a-language", config, theme), undefined);
	assert.equal(renderShikiLines(CODE, "definitely-not-a-language", config, theme), undefined);
});

test("entry count is bounded: the first fence is evicted after the cache fills", () => {
	const theme = minimalTheme();
	const first = renderShikiLines(CODE, "ts", config, theme);
	assert.ok(first);

	// Fill the cache (limit 64): fences 2..65 trigger a clear when the map is
	// full, which evicts the very first entry.
	for (let i = 0; i < 65; i++) {
		const rendered = renderShikiLines(`const v${i} = ${i};`, "ts", config, theme);
		assert.ok(rendered, `fence ${i} must render`);
	}

	const again = renderShikiLines(CODE, "ts", config, theme);
	assert.ok(again);
	assert.notStrictEqual(again, first, "evicted entry must be re-tokenized, not resurrected");
});

test("end-to-end: rendering the same markdown twice produces identical lines", () => {
	registerShikiCodeBlockRenderer(() => config);
	const render = (): string[] => new Markdown("```ts\nconst x = 1;\n```\n", 0, 0, {
		heading: identity,
		link: identity,
		linkUrl: identity,
		code: identity,
		codeBlock: identity,
		codeBlockBorder: identity,
		quote: identity,
		quoteBorder: identity,
		hr: identity,
		listBullet: identity,
		bold: identity,
		italic: identity,
		strikethrough: identity,
		underline: identity,
	} as never).render(60);

	const first = render();
	const second = render();
	assert.deepEqual(second, first, "cached second render must match the cold first render");
});
