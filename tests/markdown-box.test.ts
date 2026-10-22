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

function renderMarkdown(source: string, width: number): string[] {
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

test("formatted code boxes draw both borders on every content row", () => {
	const lines = renderMarkdown("```ts\nconst x = 1;\nconst y = 2;\n```\n", 60);
	const rendered = lines.map(stripAnsi);

	assert.ok(rendered.some((line) => line.startsWith("╭") && line.endsWith("╮")), `top border: ${JSON.stringify(rendered)}`);
	assert.ok(rendered.some((line) => line.startsWith("╰") && line.endsWith("╯")), `bottom border: ${JSON.stringify(rendered)}`);
	const contentRows = rendered.filter((line) => line.startsWith("│"));
	assert.ok(contentRows.length >= 2, `expected two content rows: ${JSON.stringify(rendered)}`);
	for (const row of contentRows) {
		assert.ok(row.trimEnd().endsWith("│"), `content row missing right border: ${JSON.stringify(row)}`);
		assert.equal(visibleWidth(row), 60, `content row must span the full width: ${JSON.stringify(row)}`);
	}
});

test("over-long code lines wrap inside the box without losing borders", () => {
	const longLine = `const value = "${"a".repeat(90)}";`;
	const lines = renderMarkdown("```ts\n" + longLine + "\n```\n", 60);
	const rendered = lines.map(stripAnsi);
	const contentRows = rendered.filter((line) => line.startsWith("│"));

	assert.ok(contentRows.length >= 2, `expected wrapped content rows: ${JSON.stringify(rendered)}`);
	for (const row of contentRows) {
		assert.ok(row.trimEnd().endsWith("│"), `wrapped row missing right border: ${JSON.stringify(row)}`);
	}
	const rejoined = contentRows.map((row) => row.slice(2, -2).trimEnd()).join("");
	const squeeze = (text: string): string => text.replace(/\s+/g, "");
	assert.ok(
		squeeze(rejoined).includes(squeeze(longLine)),
		`wrapped content lost text: ${JSON.stringify(rejoined)}`,
	);
});

test("long fence language labels keep the top-right corner", () => {
	const lines = renderMarkdown("```" + "supercalifragilisticexpialidocious".repeat(2) + "\nconst x = 1;\n```\n", 30);
	const rendered = lines.map(stripAnsi);
	const top = rendered.find((line) => line.startsWith("╭"));
	assert.ok(top, `expected a top border row: ${JSON.stringify(rendered)}`);
	assert.ok(top.endsWith("╮"), `long label clipped the corner: ${JSON.stringify(top)}`);
	assert.equal(visibleWidth(top), 30, `top border must span the full width: ${JSON.stringify(top)}`);
});
