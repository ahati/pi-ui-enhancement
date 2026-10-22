import assert from "node:assert/strict";
import test from "node:test";
import { Box, type Component } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { renderEditDiffResult } from "../src/diff-renderer.ts";
import { createShikiDiffBlockHighlighter } from "../src/shiki-codeblock-renderer.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";

// pi's per-line highlighter (basic mode) reads the module theme; without this
// it silently emits plain text in headless tests.
initTheme("dark");

function shikiConfig(overrides: Partial<ToolDisplayConfig> = {}): ToolDisplayConfig {
	return { ...DEFAULT_TOOL_DISPLAY_CONFIG, ...overrides };
}

function renderInsideToolBox(component: Component, width: number): string[] {
	const box = new Box(1, 1);
	box.addChild(component);
	return box.render(width);
}

const ansiTheme = {
	fg: (_color: string, text: string): string => `\x1b[38;2;140;150;160m${text}\x1b[39m`,
	bg: (_color: string, text: string): string => `\x1b[48;2;37;65;49m${text}\x1b[49m`,
	bold: (text: string): string => `\x1b[1m${text}\x1b[22m`,
	getFgAnsi: (slot: string): string =>
		slot === "toolDiffAdded" ? "\x1b[38;2;104;183;141m"
			: slot === "toolDiffRemoved" ? "\x1b[38;2;234;127;129m"
			: "",
	getBgAnsi: (slot: string): string =>
		slot === "toolSuccessBg" ? "\x1b[48;2;37;65;49m" : "",
};

test("shiki diff block highlighter emits fg-only truecolor tokens and preserves multi-line state", () => {
	const highlightBlock = createShikiDiffBlockHighlighter("ts", shikiConfig());
	assert.ok(highlightBlock, "expected a shiki block highlighter for the ts language");

	const lines = highlightBlock("const template = `\nplain inside template ${1 + 1}\n`;");
	assert.ok(lines, "expected shiki output for a ts block");
	assert.equal(lines!.length, 3, "expected one output line per input line");

	const joined = lines!.join("\n");
	assert.ok(joined.includes("\x1b[38;2;"), "expected truecolor foreground codes");
	assert.ok(!joined.includes("\x1b[0m"), "token resets must not use full reset (would kill row backgrounds)");
	assert.ok(!joined.includes("\x1b[22m"), "bold must be dropped so context dim survives");
	assert.ok(!joined.includes("\x1b[49m"), "highlighter must not emit background codes");

	// The continuation line inside the template literal must be tokenized, which
	// per-line highlighting cannot do (it lacks the opening backtick context).
	assert.ok(
		lines![1].includes("\x1b[38;2;"),
		`expected multi-line template content to stay highlighted: ${JSON.stringify(lines![1])}`,
	);
});

test("shiki diff block highlighter is unavailable in off mode and for unknown grammars", () => {
	assert.equal(createShikiDiffBlockHighlighter("ts", shikiConfig({ diffSyntaxHighlighting: "off" })), undefined);
	assert.equal(createShikiDiffBlockHighlighter("ts", shikiConfig({ diffSyntaxHighlighting: "basic" })), undefined);

	const unknown = createShikiDiffBlockHighlighter("cmake", shikiConfig());
	assert.ok(unknown, "cmake resolves to a language name");
	assert.equal(unknown("project(foo)"), undefined, "grammars outside the bundle must fall back, not throw");
});

test("edit diffs use shiki block highlighting and keep row backgrounds intact", () => {
	const component = renderEditDiffResult(
		{
			diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n const before = 1;\n-const removed = `open\n+const added = `open\n still inside template`;\n",
		},
		{ expanded: true, filePath: "src/a.ts" },
		shikiConfig(),
		ansiTheme,
		"",
	);

	const lines = renderInsideToolBox(component, 100).map((line) => stripBoxPadding(line));
	const changedRows = lines.filter((line) => line.includes("added"));
	assert.ok(changedRows.length > 0, `expected added rows: ${JSON.stringify(lines)}`);
	const joined = changedRows.join("\n");
	assert.ok(joined.includes("\x1b[38;2;"), "expected shiki truecolor syntax colors on changed rows");
	assert.ok(joined.includes("\x1b[48;2;"), "expected row background to survive alongside syntax colors");
	assert.ok(!joined.includes("\x1b[0m"), "no full resets may appear inside painted rows");
});

test("diffSyntaxHighlighting off removes syntax colors but keeps diff chrome", () => {
	const diff = {
		diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const removed = 1;\n+const added = 2;\n",
	};
	const options = { expanded: true, filePath: "src/a.ts" };

	const offLines = renderInsideToolBox(
		renderEditDiffResult(diff, options, shikiConfig({ diffSyntaxHighlighting: "off" }), ansiTheme, ""),
		100,
	).map((line) => stripBoxPadding(line));
	const offChanged = offLines.filter((line) => stripAnsi(line).includes("added"));
	assert.ok(offChanged.length > 0, `expected added rows: ${JSON.stringify(offLines)}`);
	assert.ok(
		!offChanged.join("\n").includes("\x1b[38;5;"),
		`off mode must not emit syntax colors: ${JSON.stringify(offChanged)}`,
	);

	const basicLines = renderInsideToolBox(
		renderEditDiffResult(diff, options, shikiConfig({ diffSyntaxHighlighting: "basic" }), ansiTheme, ""),
		100,
	).map((line) => stripBoxPadding(line));
	const basicChanged = basicLines.filter((line) => stripAnsi(line).includes("added"));
	assert.ok(
		basicChanged.join("\n").includes("\x1b[38;5;"),
		"basic mode should fall back to pi's per-line highlighter (256-color codes)",
	);
});

test("context rows are dimmed and the dim survives token resets", () => {
	const component = renderEditDiffResult(
		{
			diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const context = 1;\n-const removed = 1;\n+const added = 2;\n",
		},
		{ expanded: true, filePath: "src/a.ts" },
		shikiConfig(),
		ansiTheme,
		"",
	);

	const lines = renderInsideToolBox(component, 100).map((line) => stripBoxPadding(line));
	const contextRow = lines.find((line) => stripAnsi(line).includes("const context"));
	assert.ok(contextRow, `expected a context row: ${JSON.stringify(lines)}`);
	assert.ok(contextRow!.includes("\x1b[2m"), "context rows must carry the dim attribute");

	// Every dim-clearing reset (0m / 22m) must be followed by a dim re-assert.
	const sequences = contextRow!.match(/\x1b\[[0-9;]*m/g) ?? [];
	let dimActive = false;
	for (let index = 0; index < sequences.length; index++) {
		const params = sequences[index].slice(2, -1).split(";").filter(Boolean).map(Number);
		if (params.includes(2)) dimActive = true;
		if (params.includes(0) || params.includes(22)) {
			const next = sequences[index + 1] ?? "";
			assert.ok(next.includes("\x1b[2m"), `dim-clearing reset must be followed by a dim re-assert at ${index}`);
		}
	}
	assert.ok(dimActive, "expected dim to be asserted at least once");
});

function stripBoxPadding(line: string): string {
	return line.replace(/^\x1b\[48;2;\d+;\d+;\d+m/, "").trimEnd();
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}
