import assert from "node:assert/strict";
import test from "node:test";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { registerShikiCodeBlockRenderer } from "../src/shiki-codeblock-renderer.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../src/types.ts";

const identity = (text: string): string => text;
const stubTheme = {
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
};

function renderMarkdown(source: string, width: number): readonly string[] {
	return new Markdown(source, 0, 0, stubTheme).render(width);
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const boxConfig = (): typeof DEFAULT_TOOL_DISPLAY_CONFIG => ({
	...DEFAULT_TOOL_DISPLAY_CONFIG,
	enableShikiCodeBlocks: true,
	formatCodeBlocks: true,
	shikiCodeBlockTheme: "github-dark",
	diffSyntaxHighlighting: "shiki",
});

registerShikiCodeBlockRenderer(boxConfig);

test("formatted code blocks draw only horizontal rules", () => {
	const lines = renderMarkdown("```ts\nconst x = 1;\nconst y = 2;\n```\n", 60);
	const rendered = lines.map(stripAnsi);

	const top = rendered.find((line) => line.startsWith("─ ts "));
	assert.ok(top, `top rule with language label: ${JSON.stringify(rendered)}`);
	assert.match(top, /^─ ts ─+$/, `top rule shape: ${JSON.stringify(top)}`);
	assert.equal(visibleWidth(top), 60, `top rule must span the full width: ${JSON.stringify(top)}`);

	const bottom = rendered[rendered.length - 1];
	assert.match(bottom, /^─+$/, `bottom rule shape: ${JSON.stringify(bottom)}`);
	assert.equal(visibleWidth(bottom), 60, `bottom rule must span the full width: ${JSON.stringify(bottom)}`);
	assert.notEqual(bottom, top, "the label must only appear on the top rule");

	const contentRows = rendered.filter((line) => line.startsWith(" ") && line.trim().length > 0);
	assert.equal(contentRows.length, 2, `expected two content rows: ${JSON.stringify(rendered)}`);
	for (const row of contentRows) {
		assert.ok(row.endsWith(" "), `content row must stay padded: ${JSON.stringify(row)}`);
		assert.equal(visibleWidth(row), 60, `content row must span the full width: ${JSON.stringify(row)}`);
	}
	assert.ok(!rendered.some((line) => line.includes("│")), `side borders must be gone: ${JSON.stringify(rendered)}`);
});

test("over-long code lines wrap inside the rules without losing text", () => {
	const longLine = `const value = "${"a".repeat(90)}";`;
	const lines = renderMarkdown("```ts\n" + longLine + "\n```\n", 60);
	const rendered = lines.map(stripAnsi);
	const contentRows = rendered.filter((line) => line.startsWith(" "));

	assert.ok(contentRows.length >= 2, `expected wrapped content rows: ${JSON.stringify(rendered)}`);
	for (const row of contentRows) {
		assert.equal(visibleWidth(row), 60, `wrapped row must span the full width: ${JSON.stringify(row)}`);
	}
	const rejoined = contentRows.map((row) => row.slice(1, -1).trimEnd()).join("");
	const squeeze = (text: string): string => text.replace(/\s+/g, "");
	assert.ok(
		squeeze(rejoined).includes(squeeze(longLine)),
		`wrapped content lost text: ${JSON.stringify(rejoined)}`,
	);
});

test("long fence language labels are truncated to keep the rule full width", () => {
	const lines = renderMarkdown("```" + "supercalifragilisticexpialidocious".repeat(2) + "\nconst x = 1;\n```\n", 30);
	const rendered = lines.map(stripAnsi);
	const top = rendered.find((line) => line.startsWith("─ "));
	assert.ok(top, `expected a top rule row: ${JSON.stringify(rendered)}`);
	assert.match(top, /^─ .*… ─+$/, `long label must be ellipsized: ${JSON.stringify(top)}`);
	assert.equal(visibleWidth(top), 30, `top rule must span the full width: ${JSON.stringify(top)}`);
});

test("unlabeled fences draw matching full-width rules", () => {
	const rendered = renderMarkdown("```\nconst x = 1;\n```\n", 24).map(stripAnsi);
	const rules = rendered.filter((line) => /^─+$/.test(line));

	assert.equal(rules.length, 2, `expected top and bottom rules: ${JSON.stringify(rendered)}`);
	for (const rule of rules) {
		assert.equal(visibleWidth(rule), 24, `rule must span the full width: ${JSON.stringify(rule)}`);
	}
	assert.ok(!rendered.some((line) => line.includes("│")), `side borders must be gone: ${JSON.stringify(rendered)}`);
});
