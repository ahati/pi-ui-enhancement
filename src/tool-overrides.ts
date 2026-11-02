import type {
	ExtensionAPI,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { logToolDisplayDebug } from "./debug-logger.js";
import { registerCleanup } from "./disposable.js";
import {
	buildPromptSnippetFromDescription,
	getTextField,
	isMcpToolCandidate,
	isMcpToolNameCandidate,
	MCP_PROXY_PROMPT_GUIDELINES,
	MCP_PROXY_PROMPT_SNIPPET,
	toRecord,
} from "./tool-metadata.js";
import type { BuiltInToolOverrideName, CustomToolOverrideConfig } from "./types.js";
import { createBuiltInRenderers } from "./tool-overrides/builtin-renderers.js";
import {
	formatGenericToolCallLine,
	getStringField,
	getToolContentArg,
} from "./tool-overrides/formatting.js";
import {
	applyToolDisplayDecorationInPlace,
	decoratedToolDescriptors,
	decoratedTools,
	installToolDisplayApi,
	restoreToolPropertyDescriptors,
	tryGetAllTools,
} from "./tool-overrides/legacy-compat.js";
import {
	formatMcpCallLine,
	getExactCustomToolOverride,
	getRuntimeCustomToolOverride,
	getWildcardCustomToolOverride,
	isBuiltInToolName,
	renderCustomToolResult,
	renderMcpResult,
} from "./tool-overrides/mcp-custom-renderers.js";
import {
	TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY,
	WRITE_EXECUTION_META_LIMIT,
	type CodemodeWriteObserver,
	type ConfigGetter,
	type PiWithRegisterToolInterception,
	type PiWithToolRendererChain,
	type RenderTheme,
	type RuntimeToolDefinition,
	type ToolDisplayAdapter,
	type ToolDisplayApi,
	type ToolRenderInput,
	type WriteExecutionMeta,
} from "./tool-overrides/types.js";
import {
	captureExistingWriteContent,
	clearWriteExecutionMeta,
	getWriteExecutionMeta,
	recordWriteExecutionMeta,
} from "./tool-overrides/write-meta.js";

export type {
	CodemodeWriteObserver,
	RenderTheme,
	ToolDisplayAdapter,
	ToolDisplayApi,
	WriteExecutionMeta,
};
export {
	clearWriteExecutionMeta,
	formatMcpCallLine,
	getWriteExecutionMeta,
	recordWriteExecutionMeta,
	renderMcpResult,
	WRITE_EXECUTION_META_LIMIT,
};

export function registerToolDisplayOverrides(
	pi: ExtensionAPI,
	getConfig: ConfigGetter,
	codemodeWriteObserver?: CodemodeWriteObserver,
): void {
	const toolDisplayApi = installToolDisplayApi(getConfig);
	registerCleanup(() => {
		restoreToolPropertyDescriptors(decoratedToolDescriptors, decoratedTools);
	});

	const writeExecutionMetaByToolCallId = new Map<string, WriteExecutionMeta>();
	const capturedBuiltInRenderers = createBuiltInRenderers(getConfig, writeExecutionMetaByToolCallId);

	const pendingWriteCaptures = new Map<
		string,
		{ path: string; previous: { existed: boolean; content?: string }; content: string }
	>();

	pi.on("tool_call", (event) => {
		if (event.toolName !== "write") return;
		if (getConfig().disableEnhancedToolRender.write) return;
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
		if (!toolCallId) return;
		const path = getStringField(event.input, "path") ?? getStringField(event.input, "file_path");
		const previous = captureExistingWriteContent(process.cwd(), path, {
			allowExternalDiffPreviews: getConfig().allowExternalDiffPreviews,
		});
		recordWriteExecutionMeta(writeExecutionMetaByToolCallId, toolCallId, {
			fileExistedBeforeWrite: previous.existed,
			previousContent: previous.content,
		});
		if (path && codemodeWriteObserver?.isNested(toolCallId)) {
			pendingWriteCaptures.set(toolCallId, {
				path,
				previous,
				content: getToolContentArg(event.input) ?? "",
			});
		}
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "write" || event.isError === true) return;
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
		if (!toolCallId) return;
		const pending = pendingWriteCaptures.get(toolCallId);
		if (!pending) return;
		pendingWriteCaptures.delete(toolCallId);
		try {
			codemodeWriteObserver?.record(toolCallId, pending.path, pending.previous, pending.content);
		} catch {
			// A failed diff capture must not fail the write.
		}
	});

	const decoratedCustomTools = new WeakSet<RuntimeToolDefinition>();

	const getCustomOverrideForCandidate = (candidate: unknown): {
		toolName: string;
		override: CustomToolOverrideConfig;
	} | undefined => {
		const toolName = getTextField(candidate, "name");
		if (!toolName) {
			return undefined;
		}

		const config = getConfig();
		const exact = getExactCustomToolOverride(toolName, config);
		if (exact?.enabled) {
			return { toolName, override: exact };
		}

		if (
			isBuiltInToolName(toolName) ||
			toolName === "codemode" ||
			isMcpToolCandidate(candidate) ||
			isMcpToolNameCandidate(toolName)
		) {
			return undefined;
		}

		const wildcard = getWildcardCustomToolOverride(config);
		if (!wildcard?.enabled) {
			return undefined;
		}

		return { toolName, override: wildcard };
	};

	const decorateCustomToolOverrideCandidate = (candidate: unknown): boolean => {
		const customOverride = getCustomOverrideForCandidate(candidate);
		if (!customOverride) {
			return false;
		}

		const { toolName, override } = customOverride;
		const runtimeTool = candidate as RuntimeToolDefinition;
		if (decoratedCustomTools.has(runtimeTool)) {
			return true;
		}

		const adapter: ToolDisplayAdapter = {
			kind: override.kind,
			overrideExistingRenderers: true,
			preserveCallRenderer: override.preserveCallRenderer === true,
			renderResult(result, options, theme) {
				return renderCustomToolResult(
					result as ToolRenderInput,
					options,
					getConfig(),
					override.outputMode,
					theme,
				);
			},
		};
		if (!override.preserveCallRenderer) {
			adapter.renderCall = (args, theme) => {
				if (override.kind === "mcp") {
					return formatMcpCallLine("mcp", "MCP Proxy", toRecord(args), theme);
				}
				return formatGenericToolCallLine(toolName, args, theme);
			};
		}

		if (!applyToolDisplayDecorationInPlace(runtimeTool, toolDisplayApi, adapter)) {
			return false;
		}

		decoratedCustomTools.add(runtimeTool);
		return true;
	};

	const decoratedMcpTools = new WeakSet<RuntimeToolDefinition>();

	const decorateMcpToolCandidate = (candidate: unknown): void => {
		if (getCustomOverrideForCandidate(candidate)) {
			return;
		}

		if (!isMcpToolCandidate(candidate)) {
			return;
		}

		const toolName = getTextField(candidate, "name");
		const runtimeTool = candidate as RuntimeToolDefinition;
		if (!toolName || decoratedMcpTools.has(runtimeTool)) {
			return;
		}

		const toolRecord = toRecord(candidate);
		const prepareArgumentsDelegate =
			typeof toolRecord.prepareArguments === "function"
				? (toolRecord.prepareArguments as (args: unknown) => unknown)
				: undefined;
		const toolLabel =
			getTextField(candidate, "label") ||
			(toolName === "mcp" ? "MCP Proxy" : `MCP ${toolName}`);
		const toolDescription =
			getTextField(candidate, "description") || "MCP tool";
		const parameters = toRecord(toolRecord.parameters);

		const promptMetadata =
			toolName === "mcp"
				? {
						promptSnippet: MCP_PROXY_PROMPT_SNIPPET,
						promptGuidelines: [...MCP_PROXY_PROMPT_GUIDELINES],
					}
				: {
						promptSnippet: buildPromptSnippetFromDescription(
							toolDescription,
							`Call MCP tool '${toolName}'.`,
						),
					};

		if (!applyToolDisplayDecorationInPlace(
			runtimeTool,
			toolDisplayApi,
			{
				kind: "mcp",
				overrideExistingRenderers: true,
				renderCall(args, theme) {
					return formatMcpCallLine(toolName, toolLabel, toRecord(args), theme);
				},
				renderResult(result, options, theme) {
					return renderMcpResult(
						result as ToolRenderInput,
						options,
						getConfig(),
						theme,
					);
				},
			},
		)) {
			return;
		}
		Object.assign(runtimeTool, {
			label: toolLabel,
			description: toolDescription,
			...promptMetadata,
			parameters,
			prepareArguments: prepareArgumentsDelegate,
		});

		decoratedMcpTools.add(runtimeTool);
	};

	const installMcpRegistrationInterceptor = (): void => {
		const piWithInterception = pi as PiWithRegisterToolInterception;
		const existingInterception = piWithInterception[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY];
		if (existingInterception && pi.registerTool === existingInterception.wrapped) {
			pi.registerTool = existingInterception.original;
			delete piWithInterception[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY];
		}

		const originalRegisterTool = pi.registerTool;
		const wrappedRegisterTool = function registerToolWithMcpDecoration(
			this: ExtensionAPI,
			tool: ToolDefinition,
		): void {
			try {
				if (!decorateCustomToolOverrideCandidate(tool)) {
					decorateMcpToolCandidate(tool);
				}
			} catch (error) {
				logToolDisplayDebug("Tool display registration decoration failed.", error);
			}
			originalRegisterTool.call(this, tool);
		} as ExtensionAPI["registerTool"];

		pi.registerTool = wrappedRegisterTool;
		piWithInterception[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY] = {
			original: originalRegisterTool,
			wrapped: wrappedRegisterTool,
		};

		registerCleanup(() => {
			if (pi.registerTool === wrappedRegisterTool) {
				pi.registerTool = originalRegisterTool;
			}
			const currentInterception = piWithInterception[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY];
			if (currentInterception?.wrapped === wrappedRegisterTool) {
				delete piWithInterception[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY];
			}
		});
	};

	const registerBuiltInToolRendererChain = (): void => {
		const registerToolRenderer = (pi as PiWithToolRendererChain).registerToolRenderer;
		if (!registerToolRenderer) {
			return;
		}

		registerToolRenderer.call(pi as PiWithToolRendererChain, (toolName, next) => {
			const config = getConfig();
			const ours = capturedBuiltInRenderers.get(toolName as BuiltInToolOverrideName);
			if (ours && !config.disableEnhancedToolRender[toolName as BuiltInToolOverrideName]) {
				return { ...next(), ...ours };
			}

			if (isBuiltInToolName(toolName)) {
				return next();
			}

			if (toolName === "codemode" || isMcpToolNameCandidate(toolName)) {
				return next();
			}

			const override = getRuntimeCustomToolOverride(toolName, config);
			if (!override?.enabled) {
				return next();
			}
			return {
				...next(),
				renderCall: (args: unknown, theme: RenderTheme) => formatGenericToolCallLine(toolName, args, theme),
				renderResult: (result: unknown, options: ToolRenderResultOptions, theme: RenderTheme) =>
					renderCustomToolResult(result as ToolRenderInput, options, config, override.outputMode, theme),
			};
		});
	};
	registerBuiltInToolRendererChain();

	installMcpRegistrationInterceptor();

	const registerMcpToolOverrides = (): void => {
		const allTools = tryGetAllTools(pi, "MCP tool override discovery failed.");
		if (!allTools) {
			return;
		}

		for (const candidate of allTools) {
			if (!decorateCustomToolOverrideCandidate(candidate)) {
				decorateMcpToolCandidate(candidate);
			}
		}
	};

	const mcpDiscoveryRetryTimers = new Set<ReturnType<typeof setTimeout> & { unref?: () => void }>();
	registerCleanup(() => {
		for (const timer of mcpDiscoveryRetryTimers) {
			clearTimeout(timer);
		}
		mcpDiscoveryRetryTimers.clear();
	});

	const scheduleMcpToolOverrideDiscovery = (): void => {
		for (const delayMs of [25, 75, 150, 300]) {
			const timer = setTimeout(() => {
				mcpDiscoveryRetryTimers.delete(timer);
				registerMcpToolOverrides();
			}, delayMs) as ReturnType<typeof setTimeout> & { unref?: () => void };
			mcpDiscoveryRetryTimers.add(timer);
			timer.unref?.();
		}
	};

	pi.on("session_start", async () => {
		clearWriteExecutionMeta(writeExecutionMetaByToolCallId);
		pendingWriteCaptures.clear();
		registerMcpToolOverrides();
		scheduleMcpToolOverrideDiscovery();
	});
	pi.on("before_agent_start", async () => {
		clearWriteExecutionMeta(writeExecutionMetaByToolCallId);
		pendingWriteCaptures.clear();
		registerMcpToolOverrides();
	});
}
