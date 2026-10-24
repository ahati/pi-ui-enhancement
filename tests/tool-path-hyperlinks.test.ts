import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setCapabilityOverrides } from "@earendil-works/pi-tui";
import { registerToolDisplayOverrides } from "../src/tool-overrides.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../src/types.ts";

interface RegisteredToolLike {
	name: string;
	renderCall?: (args: Record<string, unknown>, theme: RenderThemeLike) => RenderComponentLike;
	renderResult?: (...args: unknown[]) => unknown;
}

interface RenderThemeLike {
	fg(color: string, value: string): string;
	bold(value: string): string;
}

interface RenderComponentLike {
	render(width: number): string[];
}

interface ToolEventHandlers {
	session_start?: () => Promise<void> | void;
	before_agent_start?: () => Promise<void> | void;
}

// pi-tui hyperlink() format (dist/terminal-image.js): OSC 8 with ST terminators.
const OSC8_OPEN = /\x1b\]8;;[^\x1b]*\x1b\\/g;
const OSC8_CLOSE = /\x1b\]8;;\x1b\\/g;

function stripLinks(text: string): string {
	return text.replace(OSC8_OPEN, "").replace(OSC8_CLOSE, "");
}

function createTheme(): RenderThemeLike {
	return {
		fg: (_color: string, value: string): string => value,
		bold: (value: string): string => value,
	};
}

async function registerAndGetCallRenderers(): Promise<Map<string, NonNullable<RegisteredToolLike["renderCall"]>>> {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		registerToolRenderer(): void {},
		registerCodeModeTool(): void {},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			return [];
		},
	} as unknown as ExtensionAPI;

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.session_start?.();

	const byName = new Map<string, NonNullable<RegisteredToolLike["renderCall"]>>();
	for (const tool of registeredTools) {
		if (typeof tool.renderCall === "function") {
			byName.set(tool.name, tool.renderCall);
		}
	}
	return byName;
}

function renderCallLine(
	renderCall: NonNullable<RegisteredToolLike["renderCall"]>,
	args: Record<string, unknown>,
): string {
	const component = renderCall(args, createTheme());
	return component.render(200).join("\n");
}

test("read call row wraps the path in an OSC 8 file link when the terminal supports hyperlinks", async () => {
	const callRenderers = await registerAndGetCallRenderers();
	const renderCall = callRenderers.get("read");
	assert.ok(renderCall, "expected a registered read call renderer");

	setCapabilityOverrides({ hyperlinks: true });
	try {
		const linked = renderCallLine(renderCall, { file_path: "/tmp/proj/index.ts" });
		assert.ok(linked.includes("\x1b]8;;file:///tmp/proj/index.ts\x1b\\"), `expected file link: ${JSON.stringify(linked)}`);
		assert.ok(linked.includes("index.ts"), "visible path text must survive");

		setCapabilityOverrides({ hyperlinks: false });
		const plain = renderCallLine(renderCall, { file_path: "/tmp/proj/index.ts" });
		assert.ok(!plain.includes("\x1b]8;"), `unsupported terminal must get no link: ${JSON.stringify(plain)}`);
		assert.equal(stripLinks(linked), plain, "visible text must be identical with and without links");
	} finally {
		setCapabilityOverrides({ hyperlinks: false });
	}
});

test("edit and write call rows link their primary path", async () => {
	const callRenderers = await registerAndGetCallRenderers();
	const editCall = callRenderers.get("edit");
	const writeCall = callRenderers.get("write");
	assert.ok(editCall && writeCall, "expected edit and write call renderers");

	setCapabilityOverrides({ hyperlinks: true });
	try {
		const editLine = renderCallLine(editCall, { file_path: "/tmp/proj/app.ts", old_string: "a", new_string: "b" });
		assert.ok(editLine.includes("\x1b]8;;file:///tmp/proj/app.ts\x1b\\"), `edit row not linked: ${JSON.stringify(editLine)}`);

		const writeLine = renderCallLine(writeCall, { path: "/tmp/proj/new.txt", content: "hello" });
		assert.ok(writeLine.includes("\x1b]8;;file:///tmp/proj/new.txt\x1b\\"), `write row not linked: ${JSON.stringify(writeLine)}`);
	} finally {
		setCapabilityOverrides({ hyperlinks: false });
	}
});

test("ls call row links its scope directory", async () => {
	const callRenderers = await registerAndGetCallRenderers();
	const lsCall = callRenderers.get("ls");
	assert.ok(lsCall, "expected an ls call renderer");

	setCapabilityOverrides({ hyperlinks: true });
	try {
		const line = renderCallLine(lsCall, { path: "/tmp/proj/src" });
		assert.ok(line.includes("\x1b]8;;file:///tmp/proj/src\x1b\\"), `ls scope not linked: ${JSON.stringify(line)}`);
	} finally {
		setCapabilityOverrides({ hyperlinks: false });
	}
});

test("relative paths resolve against the host process cwd", async () => {
	const callRenderers = await registerAndGetCallRenderers();
	const renderCall = callRenderers.get("read");
	assert.ok(renderCall);

	setCapabilityOverrides({ hyperlinks: true });
	try {
		const line = renderCallLine(renderCall, { file_path: "rel/thing.ts" });
		const expected = `file://${encodeURI(process.cwd())}/rel/thing.ts`;
		assert.ok(line.includes(`\x1b]8;;${expected}\x1b\\`), `expected cwd-resolved link ${expected}: ${JSON.stringify(line)}`);
	} finally {
		setCapabilityOverrides({ hyperlinks: false });
	}
});
