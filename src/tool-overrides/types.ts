import type {
	ExtensionAPI,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { ToolDisplayConfig } from "../types.js";

export type ConfigGetter = () => ToolDisplayConfig;

export interface RuntimeToolDefinition {
	name?: string;
	label?: string;
	description?: string;
	parameters?: unknown;
	prepareArguments?: unknown;
	renderCall?: (args: Record<string, unknown>, theme: RenderTheme, context?: ToolRenderContextLike) => unknown;
	renderResult?: (result: Record<string, unknown>, options: ToolRenderResultOptions, theme: RenderTheme, context?: ToolRenderContextLike) => unknown;
	execute?: (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: { cwd: string }) => Promise<unknown>;
	renderShell?: unknown;
	[key: string]: unknown;
}

export interface RenderTheme {
	fg(color: string, text: string): string;
	bg?(color: string, text: string): string;
	bold(text: string): string;
	getBgAnsi?(color: string): string;
}

export interface RtkCompactionInfo {
	applied: boolean;
	techniques: string[];
	truncated: boolean;
	originalLineCount?: number;
	compactedLineCount?: number;
}

export interface ToolRenderContextLike {
	args?: unknown;
	toolCallId?: string;
	state?: unknown;
	cwd?: string;
	argsComplete?: boolean;
	isError?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
}

export interface WriteExecutionMeta {
	previousContent?: string;
	fileExistedBeforeWrite: boolean;
}

export interface PendingDiffPreviewState {
	key?: string;
	data?: unknown;
}

export const RTK_COMPACTION_LABEL = "compacted by RTK";
export const WRITE_EXECUTION_META_LIMIT = 100;
export const WRITE_EXECUTION_META_STATE_KEY = "__piToolDisplayWriteExecutionMeta";
export const EDIT_PENDING_PREVIEW_STATE_KEY = "__piToolDisplayEditPendingPreview";
export const WRITE_PENDING_PREVIEW_STATE_KEY = "__piToolDisplayWritePendingPreview";
export const BASH_RESULT_STATE_KEY = "__piToolDisplayBashResult";

export const TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY = Symbol.for("pi-tool-display.registerToolInterceptor.v1");
export const TOOL_DISPLAY_DECORATED_PROPERTIES = [
	"renderCall",
	"renderResult",
	"renderShell",
	"label",
	"description",
	"promptSnippet",
	"promptGuidelines",
	"parameters",
	"prepareArguments",
] as const;

export type ToolDisplayKind = "read" | "edit" | "mcp" | "generic";

export interface ToolDisplayAdapter {
	id?: string;
	toolName?: string;
	kind?: ToolDisplayKind;
	overrideExistingRenderers?: boolean;
	/** Preserve a supplied tool's call renderer while still applying result rendering. */
	preserveCallRenderer?: boolean;
	pathFields?: string[];
	getPath?: (args: unknown) => string | undefined;
	getEditLineCount?: (args: unknown) => number;
	renderCall?: (args: unknown, theme: RenderTheme, context?: ToolRenderContextLike) => unknown;
	renderResult?: (result: unknown, options: ToolRenderResultOptions, theme: RenderTheme, context?: ToolRenderContextLike) => unknown;
}

export interface ToolDisplayApi {
	version: 1;
	decorateTool<T extends RuntimeToolDefinition>(tool: T, adapter?: ToolDisplayAdapter): T;
	registerAdapter(adapter: ToolDisplayAdapter): string;
	unregisterAdapter(id: string): boolean;
}

export type DecoratedPropertyName = typeof TOOL_DISPLAY_DECORATED_PROPERTIES[number];
export type ToolPropertyDescriptorSnapshot = Partial<Record<DecoratedPropertyName, PropertyDescriptor>>;

export type PiWithRegisterToolInterception = ExtensionAPI & {
	[TOOL_DISPLAY_REGISTER_TOOL_INTERCEPTOR_KEY]?: {
		original: ExtensionAPI["registerTool"];
		wrapped: ExtensionAPI["registerTool"];
	};
};

export type ToolRendererChainEntry = Pick<RuntimeToolDefinition, "renderCall" | "renderResult" | "renderShell">;

export type ToolRendererChainResolver = (
	toolName: string,
	next: () => ToolRendererChainEntry | undefined,
) => ToolRendererChainEntry | undefined;

// Pi >= 1.1 resolves tool renderers at render time through this chain, so a
// renderer here applies even when another extension owns the tool's execute.
export type PiWithToolRendererChain = ExtensionAPI & {
	registerToolRenderer?: (resolver: ToolRendererChainResolver) => void;
};

export interface PreviewHintContext {
	lines: string[];
	config: ToolDisplayConfig;
	theme: RenderTheme;
	options: ToolRenderResultOptions;
	details: unknown;
}

export interface McpPreviewHintContext extends PreviewHintContext {
	truncation: { truncated: boolean; fullOutputPath?: string };
}

export interface RtkHintParams {
	details: unknown;
	config: ToolDisplayConfig;
	theme: RenderTheme;
}

export type ToolRenderInput = {
	content?: Array<{ type: string; text?: string }>;
	details?: unknown;
};

export interface CodemodeWriteObserver {
	isNested(toolCallId: string): boolean;
	record(
		toolCallId: string,
		path: string,
		previous: { existed: boolean; content?: string },
		content: string,
	): void;
}
