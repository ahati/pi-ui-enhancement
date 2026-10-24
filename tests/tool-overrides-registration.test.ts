import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToolDisplayOverrides, getWriteExecutionMeta, type WriteExecutionMeta } from "../src/tool-overrides.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";

const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");
const TOOL_DISPLAY_PENDING_DECORATIONS_KEY = Symbol.for("pi-tool-display.pendingDecorations.v1");

interface RegisteredToolLike {
	name: string;
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
	renderShell?: unknown;
	execute?: (...args: unknown[]) => unknown;
}

type EventHandler = (...args: unknown[]) => Promise<void> | void;

interface ToolRendererChainEntryLike {
	renderShell?: unknown;
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
}

type ToolRendererChainResolverLike = (
	toolName: string,
	next: () => ToolRendererChainEntryLike | undefined,
) => ToolRendererChainEntryLike | undefined;

const BUILT_IN_TOOL_NAMES = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;

function buildConfig(overrides: Partial<ToolDisplayConfig>): ToolDisplayConfig {
	return {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		...overrides,
		disableEnhancedToolRender: {
			...DEFAULT_TOOL_DISPLAY_CONFIG.disableEnhancedToolRender,
			...overrides.disableEnhancedToolRender,
		},
	};
}

function createExtensionApiStub(allTools: unknown[] = []): {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	eventHandlers: Record<string, EventHandler>;
	rendererResolvers: ToolRendererChainResolverLike[];
} {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: Record<string, EventHandler> = {};
	const rendererResolvers: ToolRendererChainResolverLike[] = [];
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		registerToolRenderer(resolver: ToolRendererChainResolverLike): void {
			rendererResolvers.push(resolver);
		},
		on(event: string, handler: EventHandler): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			return allTools;
		},
	} as unknown as ExtensionAPI;

	return { api, registeredTools, eventHandlers, rendererResolvers };
}

/** Resolve the built-in renderers the chain would use, in resolver order. */
function resolveBuiltInRenderers(
	resolvers: ToolRendererChainResolverLike[],
): Map<string, ToolRendererChainEntryLike> {
	const resolved = new Map<string, ToolRendererChainEntryLike>();
	for (const name of BUILT_IN_TOOL_NAMES) {
		let entry: ToolRendererChainEntryLike | undefined;
		for (const resolver of resolvers) {
			const applied = resolver(name, () => entry);
			if (applied) entry = applied;
		}
		if (entry) {
			resolved.set(name, entry);
		}
	}
	return resolved;
}

function externalOwner(name: string, source = "local"): unknown {
	return { name, sourceInfo: { source, path: `agent/extensions/pi-ssh-remote/${name}.ts` } };
}

async function withTempDir(name: string, run: (dir: string) => Promise<void> | void): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), name));
	try {
		await run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Renderer-only built-in contract
// ---------------------------------------------------------------------------

test("built-in tools are never registered, regardless of ownership or lifecycle", async () => {
	const externalTools = [
		externalOwner("read"),
		externalOwner("bash", "package"),
		externalOwner("write"),
	];
	const { api, registeredTools, eventHandlers } = createExtensionApiStub(externalTools);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.deepEqual(registeredTools.map((tool) => tool.name), [], "nothing registers at load");

	await eventHandlers.session_start?.();
	await eventHandlers.before_agent_start?.();

	assert.deepEqual(
		registeredTools.map((tool) => tool.name),
		[],
		"no built-in registers even with external owners present",
	);
});

test("built-in renderers resolve through the chain immediately at load, no lifecycle needed", () => {
	const { api, rendererResolvers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	assert.equal(rendererResolvers.length, 1, "one chain resolver registered");

	const resolved = resolveBuiltInRenderers(rendererResolvers);
	for (const name of BUILT_IN_TOOL_NAMES) {
		const entry = resolved.get(name);
		assert.ok(entry, `${name} resolves`);
		assert.equal(typeof entry?.renderCall, "function", `${name} has renderCall`);
		assert.equal(typeof entry?.renderResult, "function", `${name} has renderResult`);
	}

	// Renderers read the live config getter at render time, so lifecycle events
	// add nothing for the built-ins (they only drive MCP/custom decoration).
	assert.equal(typeof resolved.get("edit")?.renderShell, "string");
});

test("the chain replaces an external owner's renderer for built-in tools", () => {
	const { api, rendererResolvers } = createExtensionApiStub([
		externalOwner("read"),
		externalOwner("edit"),
	]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
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
});

test("per-tool config flags gate built-in rendering without any registration", () => {
	const config = buildConfig({
		disableEnhancedToolRender: {
			read: false,
			grep: true,
			find: true,
			ls: true,
			bash: true,
			edit: true,
			write: true,
		},
	});
	const { api, registeredTools, rendererResolvers } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => config);
	assert.deepEqual(registeredTools.map((tool) => tool.name), [], "nothing registers");

	const resolver = rendererResolvers[0];
	assert.ok(resolver("read", () => undefined), "read renders when not disabled");
	assert.equal(resolver("bash", () => undefined), undefined, "disabled bash passes through");
	assert.equal(resolver("write", () => undefined), undefined, "disabled write passes through");
});

test("getAllTools being unavailable never affects built-in rendering", () => {
	const registeredTools: RegisteredToolLike[] = [];
	const rendererResolvers: ToolRendererChainResolverLike[] = [];
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		registerToolRenderer(resolver: ToolRendererChainResolverLike): void {
			rendererResolvers.push(resolver);
		},
		on(_event: string, _handler: EventHandler): void {
			// No lifecycle needed for this test.
		},
		getAllTools(): unknown[] {
			throw new Error("Extension runtime not initialized.");
		},
	} as unknown as ExtensionAPI;

	assert.doesNotThrow(() => registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG));
	assert.deepEqual(registeredTools.map((tool) => tool.name), []);
	assert.equal(resolveBuiltInRenderers(rendererResolvers).size, BUILT_IN_TOOL_NAMES.length);
});

// ---------------------------------------------------------------------------
// Write previous-content capture via the tool_call / tool_result chain events
// ---------------------------------------------------------------------------

interface WriteCaptureHarness {
	api: ExtensionAPI;
	toolCall: (input: Record<string, unknown>, toolCallId?: string) => Promise<void>;
	toolResult: (input: Record<string, unknown>, toolCallId?: string, isError?: boolean) => Promise<void>;
	recorded: Array<{ toolCallId: string; path: string; previous: { existed: boolean; content?: string }; content: string }>;
}

function createWriteCaptureHarness(config: ToolDisplayConfig, nestedIds: Set<string>): WriteCaptureHarness {
	const { api, eventHandlers } = createExtensionApiStub();
	const recorded: WriteCaptureHarness["recorded"] = [];
	const observer = {
		isNested: (id: string) => nestedIds.has(id),
		record: (
			toolCallId: string,
			path: string,
			previous: { existed: boolean; content?: string },
			content: string,
		) => {
			recorded.push({ toolCallId, path, previous, content });
		},
	};
	registerToolDisplayOverrides(api, () => config, observer);
	return {
		api,
		recorded,
		toolCall: async (input, toolCallId = "write-1") => {
			await eventHandlers.tool_call?.({ toolName: "write", toolCallId, input });
		},
		toolResult: async (input, toolCallId = "write-1", isError = false) => {
			await eventHandlers.tool_result?.({ toolName: "write", toolCallId, input, isError });
		},
	};
}

test("write previous content is captured on tool_call and rendered as a diff", async () => {
	await withTempDir("pi-render-write-capture-", async (dir) => {
		const filePath = join(dir, "notes.txt");
		writeFileSync(filePath, "before\n", "utf8");

		const { api, eventHandlers, rendererResolvers } = createExtensionApiStub();
		registerToolDisplayOverrides(api, () => buildConfig({ allowExternalDiffPreviews: true }));

		await eventHandlers.tool_call?.({ toolName: "write", toolCallId: "w1", input: { path: filePath, content: "after\n" } });

		let writeEntry: ToolRendererChainEntryLike | undefined;
		const resolver = rendererResolvers[0];
		const resolved = resolver("write", () => writeEntry);
		if (resolved) writeEntry = resolved;
		assert.equal(typeof writeEntry?.renderResult, "function", "write renders through the chain");

		const rendered = (writeEntry!.renderResult!({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}, { isPartial: false, expanded: true }, { fg: (_c: string, t: string) => t, bold: (t: string) => t }, {
			toolCallId: "w1",
			state: {},
			args: { path: filePath, content: "after\n" },
		}) as { render(w: number): string[] }).render(120).join("\n");

		assert.match(rendered, /before/, "the captured previous content appears as a diff line");
		assert.match(rendered, /after/, "the new content appears");
	});
});

test("write capture is gated on the write rendering flag", async () => {
	await withTempDir("pi-render-write-gate-", async (dir) => {
		const filePath = join(dir, "notes.txt");
		writeFileSync(filePath, "before\n", "utf8");

		const config = buildConfig({
			disableEnhancedToolRender: {
				read: true,
				grep: true,
				find: true,
				ls: true,
				bash: true,
				edit: true,
				write: false,
			},
		});
		const harness = createWriteCaptureHarness(config, new Set());
		await harness.toolCall({ path: filePath, content: "after\n" }, "w1");
		assert.deepEqual(harness.recorded, []);
	});
});

test("successful nested writes record codemode diffs on tool_result; failures do not", async () => {
	await withTempDir("pi-render-write-codemode-", async (dir) => {
		const filePath = join(dir, "notes.txt");
		writeFileSync(filePath, "before\n", "utf8");
		const nestedIds = new Set(["nested-1", "nested-2", "nested-3"]);
		const harness = createWriteCaptureHarness(buildConfig({ allowExternalDiffPreviews: true }), nestedIds);

		await harness.toolCall({ path: filePath, content: "after\n" }, "nested-1");
		await harness.toolResult({ path: filePath }, "nested-1", false);
		assert.equal(harness.recorded.length, 1, "successful nested write records a diff");
		assert.deepEqual(
			{ path: harness.recorded[0].path, previous: harness.recorded[0].previous, content: harness.recorded[0].content },
			{ path: filePath, previous: { existed: true, content: "before\n" }, content: "after\n" },
		);

		await harness.toolCall({ path: filePath, content: "v3\n" }, "nested-2");
		await harness.toolResult({ path: filePath }, "nested-2", true);
		assert.equal(harness.recorded.length, 1, "failed write records nothing");

		await harness.toolCall({ path: filePath, content: "v4\n" }, "top-1");
		await harness.toolResult({ path: filePath }, "top-1", false);
		assert.equal(harness.recorded.length, 1, "non-nested write records nothing");
	});
});

// ---------------------------------------------------------------------------
// ToolDisplayApi + MCP/custom decoration (unchanged behavior)
// ---------------------------------------------------------------------------

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

test("bash renderResult reuses one Text component across partial updates", () => {
	const { api, registeredTools, rendererResolvers } = createExtensionApiStub();
	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	// Renderers resolve via the chain; surface them as a named tool-like entry.
	let bashEntry: ToolRendererChainEntryLike | undefined;
	const resolver = rendererResolvers[0];
	const resolved = resolver("bash", () => bashEntry);
	if (resolved) bashEntry = resolved;
	const bashTool = { name: "bash", ...(bashEntry ?? {}) } as RegisteredToolLike;
	assert.equal(registeredTools.some((tool) => tool.name === "bash"), false, "bash is not registered");
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
