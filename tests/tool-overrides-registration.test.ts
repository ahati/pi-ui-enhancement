import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { registerToolDisplayOverrides } from "../src/tool-overrides.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../src/types.ts";

const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");
const TOOL_DISPLAY_PENDING_DECORATIONS_KEY = Symbol.for("pi-tool-display.pendingDecorations.v1");

interface RegisteredToolLike {
	name: string;
	description: string;
	parameters: unknown;
	renderShell?: "default" | "self";
	promptSnippet?: string;
	promptGuidelines?: string[];
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
}

interface ToolEventHandlers {
	session_start?: () => Promise<void> | void;
	before_agent_start?: () => Promise<void> | void;
}

interface ExecutableToolLike extends RegisteredToolLike {
	execute: (...args: unknown[]) => Promise<{ content?: Array<{ type: string; text?: string }> }>;
}

async function withTempDir(name: string, run: (dir: string) => Promise<void> | void): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), name));
	try {
		await run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (result.content ?? [])
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text ?? "")
		.join("");
}

function withDefaultReadEditOwners(tools: unknown[] = []): unknown[] {
	const names = new Set(
		tools
			.map((tool) => (tool as { name?: unknown }).name)
			.filter((name): name is string => typeof name === "string"),
	);
	const defaults = ["read", "edit"]
		.filter((name) => !names.has(name))
		.map((name) => ({ name, sourceInfo: { source: "builtin", path: `<builtin:${name}>` } }));
	return [...defaults, ...tools];
}

interface ToolRendererChainEntryLike {
	renderShell?: unknown;
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
}

type ToolRendererChainResolverLike = (
	toolName: string,
	next: () => ToolRendererChainEntryLike | undefined,
) => ToolRendererChainEntryLike | undefined;

function createExtensionApiStub(allTools: unknown[] = []): {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	eventHandlers: ToolEventHandlers;
	rendererResolvers: ToolRendererChainResolverLike[];
} {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const rendererResolvers: ToolRendererChainResolverLike[] = [];
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		registerToolRenderer(resolver: ToolRendererChainResolverLike): void {
			rendererResolvers.push(resolver);
		},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			return withDefaultReadEditOwners(allTools);
		},
	} as unknown as ExtensionAPI;

	return { api, registeredTools, eventHandlers, rendererResolvers };
}

function createExtensionApiStubWithoutLoadTimeToolDiscovery(): {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	eventHandlers: ToolEventHandlers;
} {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			throw new Error("Extension runtime not initialized.");
		},
	} as unknown as ExtensionAPI;

	return { api, registeredTools, eventHandlers };
}

test("registerToolDisplayOverrides survives unavailable load-time discovery and registers before the first render", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStubWithoutLoadTimeToolDiscovery();

	// PR #34 defers registration; a discovery failure at load time must not throw
	// and must not prevent the lifecycle pass from registering the renderers.
	assert.doesNotThrow(() => registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG));
	assert.deepEqual(registeredTools.map((tool) => tool.name), []);

	await eventHandlers.before_agent_start?.();

	assert.deepEqual(
		registeredTools.map((tool) => tool.name).sort(),
		["bash", "edit", "find", "grep", "ls", "read", "write"],
	);
});

test("registerToolDisplayOverrides copies built-in prompt metadata onto overridden tools", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	// Built-in overrides are deferred until session/agent lifecycle so other
	// extensions can claim ownership first (e.g. pi-patty-bg-tasks for bash).
	assert.deepEqual(registeredTools.map((tool) => tool.name).sort(), []);
	await eventHandlers.before_agent_start?.();

	assert.deepEqual(
		registeredTools.map((tool) => tool.name).sort(),
		["bash", "edit", "find", "grep", "ls", "read", "write"],
	);
	assert.equal(registeredTools.length, 7);

	const byName = new Map(registeredTools.map((tool) => [tool.name, tool]));
	const cwd = process.cwd();
	const builtInTools = {
		read: createReadTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
	};

	for (const [name, builtInTool] of Object.entries(builtInTools)) {
		const registeredTool = byName.get(name);
		const builtInMetadata = builtInTool as unknown as RegisteredToolLike;
		assert.ok(registeredTool, `expected '${name}' to be registered`);
		assert.equal(registeredTool.promptSnippet, builtInMetadata.promptSnippet);
	}

	// Prompt metadata is copied verbatim from the built-ins, whatever the
	// installed Pi version ships (1.3's bash carries a PI_* env guideline,
	// older versions had none).
	for (const name of ["read", "grep", "find", "ls", "bash", "edit", "write"] as const) {
		const builtInMetadata = builtInTools[name] as unknown as RegisteredToolLike;
		assert.deepEqual(
			byName.get(name)?.promptGuidelines,
			builtInMetadata.promptGuidelines,
			`${name} promptGuidelines match the built-in tool`,
		);
	}
});

test("registerToolDisplayOverrides defers built-in display renderers until session lifecycle", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.equal(registeredTools.length, 0, "must not register built-ins during extension load");

	await eventHandlers.session_start?.();

	const byName = new Map(registeredTools.map((tool) => [tool.name, tool]));
	for (const name of ["read", "grep", "find", "ls", "bash", "edit", "write"] as const) {
		const registeredTool = byName.get(name);
		assert.ok(registeredTool, `expected '${name}' after session_start`);
		assert.equal(typeof registeredTool.renderCall, "function", `${name} has renderCall after session_start`);
		assert.equal(typeof registeredTool.renderResult, "function", `${name} has renderResult after session_start`);
	}
});

test("defers built-in bash override when another extension owns bash after load", async () => {
	// Simulate load-order: tool-display evaluates first (no external bash yet),
	// then pi-patty-bg-tasks registers bash before session_start/before_agent_start.
	const externalTools: unknown[] = [];
	const { api, registeredTools, eventHandlers } = createExtensionApiStub(externalTools);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.equal(registeredTools.some((tool) => tool.name === "bash"), false);

	externalTools.push({
		name: "bash",
		sourceInfo: {
			source: "package",
			path: "node_modules/pi-patty-bg-tasks/src/tools/bash.ts",
		},
	});

	await eventHandlers.session_start?.();
	await eventHandlers.before_agent_start?.();

	const registeredNames = new Set(registeredTools.map((tool) => tool.name));
	assert.equal(registeredNames.has("bash"), false, "must yield bash to external owner");
	assert.equal(registeredNames.has("read"), true);
	assert.equal(registeredNames.has("write"), true);
});

test("registerToolDisplayOverrides clones built-in parameter schemas so Pi TUI keeps extension renderers active", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.before_agent_start?.();

	const byName = new Map(registeredTools.map((tool) => [tool.name, tool]));
	const cwd = process.cwd();
	const builtInTools = {
		read: createReadTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
	};

	for (const [name, builtInTool] of Object.entries(builtInTools)) {
		const registeredTool = byName.get(name);
		assert.ok(registeredTool, `expected '${name}' to be registered`);
		assert.notEqual(
			registeredTool.parameters,
			builtInTool.parameters,
			`expected '${name}' to use a cloned parameter object`,
		);
		assert.deepEqual(registeredTool.parameters, builtInTool.parameters);
	}
});

test("registerToolDisplayOverrides forces edit into the default render shell so tool backgrounds fill the full row", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.before_agent_start?.();

	const byName = new Map(registeredTools.map((tool) => [tool.name, tool]));
	assert.equal(byName.get("edit")?.renderShell, "default");
});

test("registerToolDisplayOverrides leaves externally owned read/edit/grep tools active", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([
		{ name: "read", sourceInfo: { source: "local", path: "agent/extensions/example-read/src/read.ts" } },
		{ name: "edit", sourceInfo: { source: "local", path: "agent/extensions/example-edit/src/edit.ts" } },
		{ name: "grep", sourceInfo: { source: "local", path: "agent/extensions/example-grep/src/grep.ts" } },
	]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.before_agent_start?.();

	const registeredNames = new Set(registeredTools.map((tool) => tool.name));
	assert.equal(registeredNames.has("read"), false);
	assert.equal(registeredNames.has("edit"), false);
	assert.equal(registeredNames.has("grep"), false);
	assert.equal(registeredNames.has("find"), true);
	assert.equal(registeredNames.has("ls"), true);
	assert.equal(registeredNames.has("bash"), true);
	assert.equal(registeredNames.has("write"), true);
});

test("externally owned tools keep their execute and render through the Pi tool renderer chain", async () => {
	const { api, registeredTools, eventHandlers, rendererResolvers } = createExtensionApiStub([
		{ name: "read", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
		{ name: "edit", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
	]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	// Ownership resolves on the session lifecycle, after every extension has
	// registered its tools (PR #34 semantics kept from the upstream merges).
	assert.equal(registeredTools.length, 0, "nothing is registered at load time");
	await eventHandlers.before_agent_start?.();

	assert.equal(registeredTools.some((tool) => tool.name === "read"), false);
	assert.equal(rendererResolvers.length, 1);
	const resolver = rendererResolvers[0];

	const remoteRenderCall = () => "remote-render";
	const resolvedRead = resolver("read", () => ({ renderCall: remoteRenderCall }));
	assert.ok(resolvedRead);
	assert.notEqual(resolvedRead.renderCall, remoteRenderCall, "chain replaces the owner's renderer");
	assert.equal(typeof resolvedRead.renderResult, "function");

	assert.equal(resolver("edit", () => undefined)?.renderShell, "default");

	// Unknown tools are decorated by default through the "*" wildcard so every
	// call renders compactly; disabling the wildcard passes them through.
	const decoratedRemote = resolver("remote", () => ({ renderCall: () => "base" })) as
		{ renderCall?: (args: unknown, theme: unknown) => { render(w: number): string[] } } | undefined;
	assert.ok(decoratedRemote?.renderCall, "unknown tools get the generic renderer");
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
	const genericLine = decoratedRemote.renderCall({ a: 1 }, theme).render(120).join("\n");
	assert.match(genericLine, /remote/, "generic renderer draws the tool name");
	assert.doesNotMatch(genericLine, /^base$/, "generic renderer replaces the native call line");

	const registeredWrite = registeredTools.find((tool) => tool.name === "write");
	assert.ok(registeredWrite, "expected owned write to stay registered");
	const resolvedWrite = resolver("write", () => ({ renderCall: () => "base" }));
	assert.equal(resolvedWrite?.renderCall, registeredWrite.renderCall, "owned tools keep the registered renderer");
});

interface LateBoundApiStub {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	eventHandlers: ToolEventHandlers;
	rendererResolvers: ToolRendererChainResolverLike[];
	bindToolRegistry(tools: unknown[]): void;
}

// Pi wires pi.getAllTools() after extension load, so ownership is unknown while
// extensions load. This stub throws until the registry is bound.
function createLateBoundExtensionApiStub(): LateBoundApiStub {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const rendererResolvers: ToolRendererChainResolverLike[] = [];
	let toolRegistry: unknown[] | undefined;
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		registerToolRenderer(resolver: ToolRendererChainResolverLike): void {
			rendererResolvers.push(resolver);
		},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			if (!toolRegistry) {
				throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
			}
			return withDefaultReadEditOwners(toolRegistry);
		},
	} as unknown as ExtensionAPI;

	return {
		api,
		registeredTools,
		eventHandlers,
		rendererResolvers,
		bindToolRegistry(tools: unknown[]): void {
			toolRegistry = tools;
		},
	};
}

test("registerToolDisplayOverrides defers ownership to session start and never shadows another extension's tools", async () => {
	const { api, registeredTools, eventHandlers, rendererResolvers, bindToolRegistry } =
		createLateBoundExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.deepEqual(registeredTools.map((tool) => tool.name), [], "no built-in tool registers while ownership is unknown");
	assert.equal(rendererResolvers.length, 1, "renderers are captured for the renderer chain during load");

	bindToolRegistry([
		{ name: "read", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
		{ name: "edit", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
		{ name: "write", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
		{ name: "bash", sourceInfo: { source: "local", path: "agent/extensions/pi-ssh-remote/index.ts" } },
	]);
	await eventHandlers.session_start?.();

	const registeredNames = new Set(registeredTools.map((tool) => tool.name));
	assert.deepEqual(
		[...registeredNames].sort(),
		["find", "grep", "ls"],
		"only unowned built-ins register after the registry is known",
	);

	const resolver = rendererResolvers[0];
	const remoteRenderCall = () => "remote-render";
	const resolvedRead = resolver("read", () => ({ renderCall: remoteRenderCall }));
	assert.ok(resolvedRead);
	assert.notEqual(resolvedRead.renderCall, remoteRenderCall, "read still renders through tool-display");
});

test("registerToolDisplayOverrides registers built-in overrides at session start when no extension owns them", async () => {
	const { api, registeredTools, eventHandlers, bindToolRegistry } = createLateBoundExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.deepEqual(registeredTools.map((tool) => tool.name), []);

	bindToolRegistry([]);
	await eventHandlers.session_start?.();

	assert.deepEqual(
		registeredTools.map((tool) => tool.name).sort(),
		["bash", "edit", "find", "grep", "ls", "read", "write"],
	);
});

test("bash override uses shellPath from Pi settings", async () => {
	await withTempDir("pi-render-shellpath-", async (dir) => {
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		writeFileSync(
			join(dir, "settings.json"),
			JSON.stringify({ shellPath: "/definitely/missing/bash" }),
			"utf8",
		);

		try {
			const { api, registeredTools, eventHandlers } = createExtensionApiStub();
			registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
			await eventHandlers.before_agent_start?.();

			const bashTool = registeredTools.find((tool) => tool.name === "bash") as ExecutableToolLike | undefined;
			assert.ok(bashTool, "expected bash override to be registered");
			await assert.rejects(
				bashTool.execute("tool-call-1", { command: "printf test" }, undefined, undefined, { cwd: process.cwd() }),
				/custom shell path not found/i,
			);
			assert.equal(bashTool.description.length > 0, true);
		} finally {
			if (previousAgentDir === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			}
		}
	});
});

test("bash override uses shellCommandPrefix from Pi settings", async () => {
	await withTempDir("pi-render-shellprefix-", async (dir) => {
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		writeFileSync(
			join(dir, "settings.json"),
			JSON.stringify({ shellCommandPrefix: "printf 'prefix-output\\n'" }),
			"utf8",
		);

		try {
			const { api, registeredTools, eventHandlers } = createExtensionApiStub();
			registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
			await eventHandlers.before_agent_start?.();

			const bashTool = registeredTools.find((tool) => tool.name === "bash") as ExecutableToolLike | undefined;
			assert.ok(bashTool, "expected bash override to be registered");
			const result = await bashTool.execute(
				"tool-call-2",
				{ command: "printf 'command-output\\n'" },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			assert.equal(getTextOutput(result).trim(), "prefix-output\ncommand-output");
		} finally {
			if (previousAgentDir === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			}
		}
	});
});

test("runtime API registers and unregisters typed adapter contracts", () => {
	type GlobalWithToolDisplayApi = typeof globalThis & {
		[TOOL_DISPLAY_API_KEY]?: {
			version: number;
			decorateTool(tool: Record<string, unknown>): Record<string, unknown>;
			registerAdapter(adapter: { toolName?: string; kind?: "mcp"; overrideExistingRenderers?: boolean }): string;
			unregisterAdapter(id: string): boolean;
		};
	};
	const { api } = createExtensionApiStub();
	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	const displayApi = (globalThis as GlobalWithToolDisplayApi)[TOOL_DISPLAY_API_KEY];
	assert.ok(displayApi);

	const id = displayApi.registerAdapter({
		toolName: "adapter_mcp",
		kind: "mcp",
		overrideExistingRenderers: true,
	});
	const decorated = displayApi.decorateTool({ name: "adapter_mcp" });
	assert.equal(typeof decorated.renderCall, "function");
	assert.equal(typeof decorated.renderResult, "function");
	assert.equal(displayApi.unregisterAdapter(id), true);
	assert.equal(displayApi.unregisterAdapter(id), false);
});

test("registerToolDisplayOverrides drains pending display decorations from early-loading extensions", () => {
	type GlobalWithPendingDecorations = typeof globalThis & {
		[TOOL_DISPLAY_PENDING_DECORATIONS_KEY]?: Array<{
			tool: Record<string, unknown>;
			adapter?: Record<string, unknown>;
		}>;
	};
	const globalWithPending = globalThis as GlobalWithPendingDecorations;
	const previousPending = globalWithPending[TOOL_DISPLAY_PENDING_DECORATIONS_KEY];
	const queuedTool: Record<string, unknown> = {
		name: "mcp",
		label: "MCP Proxy",
		description: "Unified MCP gateway.",
		parameters: {},
		execute(): void {
			// No-op test stub.
		},
	};
	globalWithPending[TOOL_DISPLAY_PENDING_DECORATIONS_KEY] = [
		{
			adapter: { kind: "mcp" },
			tool: queuedTool,
		},
	];

	try {
		const { api, registeredTools } = createExtensionApiStub();

		registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

		assert.equal(registeredTools.some((tool) => tool.name === "mcp"), false);
		assert.equal(typeof queuedTool.renderCall, "function", "expected queued MCP tool to receive renderCall");
		assert.equal(typeof queuedTool.renderResult, "function", "expected queued MCP tool to receive renderResult");
		assert.equal(globalWithPending[TOOL_DISPLAY_PENDING_DECORATIONS_KEY]?.length, 0);
	} finally {
		if (previousPending) {
			globalWithPending[TOOL_DISPLAY_PENDING_DECORATIONS_KEY] = previousPending;
		} else {
			delete globalWithPending[TOOL_DISPLAY_PENDING_DECORATIONS_KEY];
		}
	}
});

test("bash renderResult reuses one Text component across partial updates", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub();
	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.before_agent_start?.();

	const bashTool = registeredTools.find((tool) => tool.name === "bash");
	assert.ok(bashTool, "bash override registered");
	assert.equal(typeof bashTool.renderResult, "function", "bash has renderResult");

	const state: Record<string, unknown> = {};
	const context = { state, args: { command: "echo hi" } };

	const first = bashTool.renderResult!(
		{ content: [{ type: "text", text: "partial" }] } as never,
		{ isPartial: true, expanded: false } as never,
		{ fg: (_c: string, t: string) => t, bold: (t: string) => t } as never,
		context as never,
	);
	const second = bashTool.renderResult!(
		{ content: [{ type: "text", text: "partial\nmore output" }] } as never,
		{ isPartial: true, expanded: false } as never,
		{ fg: (_c: string, t: string) => t, bold: (t: string) => t } as never,
		context as never,
	);

	assert.ok(first instanceof Object, "partial render returns a component");
	assert.equal(second, first, "the same Text instance is reused via context.state");
});
