import type {
	BashToolDetails,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { renderBashCall, toStateCarrier } from "../bash-display.js";
import { renderWriteDiffResult } from "../diff-renderer.js";
import { buildPendingWritePreviewData } from "../pending-diff-preview.js";
import {
	extractTextOutput,
	sanitizeAnsiForThemedOutput,
	shortenPath,
} from "../render-utils.js";
import type { BuiltInToolOverrideName } from "../types.js";
import {
	countWriteContentLines,
	getWriteContentSizeBytes,
	shouldRenderWriteCallSummary,
} from "../write-display-utils.js";
import {
	buildPreviewText,
	formatBashNoOutputLine,
	formatBashSummary,
	formatBashTruncationHints,
	formatExpandHint,
	formatSearchCallLine,
	formatWriteCallSuffix,
	getBashPreviewLineLimit,
	getExpandedPreviewLineLimit,
	getSearchScope,
	getStringField,
	getToolContentArg,
	getToolPathArg,
	isBackgroundTaskResult,
	isToolError,
	linkToolPath,
	prepareOutputLines,
	renderBashErrorResult,
	renderBashLivePreview,
	renderBashPreviewWithHints,
	reuseTextComponent,
	textResult,
} from "./formatting.js";
import {
	handleEditOrWriteResult,
	renderEditDisplayCall,
	renderEditDisplayResult,
	renderReadDisplayCall,
	renderReadDisplayResult,
} from "./legacy-compat.js";
import { renderSearchResult } from "./mcp-custom-renderers.js";
import {
	BASH_RESULT_STATE_KEY,
	WRITE_PENDING_PREVIEW_STATE_KEY,
	type ConfigGetter,
	type RenderTheme,
	type ToolRendererChainEntry,
	type ToolRenderInput,
	type WriteExecutionMeta,
} from "./types.js";
import {
	buildPendingDiffCallComponent,
	getWriteExecutionMeta,
	resolvePendingDiffPreview,
} from "./write-meta.js";

export function createBuiltInRenderers(
	getConfig: ConfigGetter,
	writeExecutionMetaByToolCallId: Map<string, WriteExecutionMeta>,
): Map<BuiltInToolOverrideName, ToolRendererChainEntry> {
	const capturedBuiltInRenderers = new Map<BuiltInToolOverrideName, ToolRendererChainEntry>();

	const registerBuiltIn = (
		toolName: BuiltInToolOverrideName,
		renderers: ToolRendererChainEntry,
	): void => {
		capturedBuiltInRenderers.set(toolName, renderers);
	};

	const renderSearchToolResult = (
		result: ToolRenderInput,
		options: ToolRenderResultOptions,
		theme: RenderTheme,
		unitLabel: string,
		pluralLabel?: string,
	): Text => {
		const config = getConfig();
		return renderSearchResult(
			result,
			options,
			config,
			theme,
			unitLabel,
			result.details as Parameters<typeof renderSearchResult>[5],
			pluralLabel,
		);
	};

	const buildSearchCallSuffix = (args: Record<string, unknown>): { scope: string; limitSuffix: string } => {
		return { scope: getSearchScope(args), limitSuffix: args.limit !== undefined ? ` (limit ${args.limit})` : "" };
	};

	registerBuiltIn("read", {
		renderCall(args, theme) {
			return renderReadDisplayCall(args, theme);
		},
		renderResult(result, options, theme) {
			return renderReadDisplayResult(result, options, getConfig(), theme);
		},
	});

	registerBuiltIn("grep", {
		renderCall(args, theme) {
			const scope = getSearchScope(args);
			const globSuffix = args.glob ? ` (${args.glob})` : "";
			const limitSuffix =
				args.limit !== undefined ? ` limit ${args.limit}` : "";
			return formatSearchCallLine("grep", `/${args.pattern}/`, ` in ${scope}${globSuffix}${limitSuffix}`, theme);
		},
		renderResult(result, options, theme) {
			return renderSearchToolResult(result, options, theme, "match", "matches");
		},
	});

	registerBuiltIn("find", {
		renderCall(args, theme) {
			const { scope, limitSuffix } = buildSearchCallSuffix(args);
			return formatSearchCallLine("find", args.pattern as string, ` in ${scope}${limitSuffix}`, theme);
		},
		renderResult(result, options, theme) {
			return renderSearchToolResult(result, options, theme, "result");
		},
	});

	registerBuiltIn("ls", {
		renderCall(args, theme) {
			const { scope, limitSuffix } = buildSearchCallSuffix(args);
			const rawScope = (args.path as string) || ".";
			return textResult(`${theme.fg("toolTitle", theme.bold("ls"))} ${linkToolPath(rawScope, theme.fg("accent", scope))}${theme.fg("muted", limitSuffix)}`);
		},
		renderResult(result, options, theme) {
			return renderSearchToolResult(result, options, theme, "entry", "entries");
		},
	});

	registerBuiltIn("edit", {
		renderShell: "default",
		renderCall(args, theme, context) {
			return renderEditDisplayCall(args, theme, context, {}, getConfig);
		},
		renderResult(result, options, theme, context) {
			return renderEditDisplayResult(result as never, options, theme, context, {}, getConfig);
		},
	});

	registerBuiltIn("write", {
		renderCall(args, theme, context) {
			const content = getToolContentArg(args);
			const lineCount = countWriteContentLines(content);
			const sizeBytes = getWriteContentSizeBytes(content);
			const rawPath = getToolPathArg(args);
			const path = shortenPath(rawPath);
			const suffix = shouldRenderWriteCallSummary({
				hasContent: content !== undefined,
				hasDetailedResultHeader: false,
			})
				? formatWriteCallSuffix(lineCount, sizeBytes, theme)
				: "";
			const summaryText = `${theme.fg("toolTitle", theme.bold("write"))} ${linkToolPath(rawPath, theme.fg("accent", path || "..."))}${suffix}`;
			if (!context?.argsComplete || !context?.isPartial) {
				return textResult(summaryText);
			}

			const config = getConfig();
			const previewKey = JSON.stringify({ path: getToolPathArg(args) ?? null, content: content ?? null });
			const previewData = resolvePendingDiffPreview(
				context,
				WRITE_PENDING_PREVIEW_STATE_KEY,
				previewKey,
				() => buildPendingWritePreviewData(args, context?.cwd ?? process.cwd(), { allowExternalDiffPreviews: config.allowExternalDiffPreviews }),
			);
			return buildPendingDiffCallComponent(summaryText, previewData, context, config, theme);
		},
		renderResult(result, options, theme, context) {
			const content = getToolContentArg(context?.args);
			const lineCount = countWriteContentLines(content);
			const { fallbackText, earlyResult } = handleEditOrWriteResult(result, options, context, theme, lineCount, "writing", "Write failed.");
			if (earlyResult) {
				return earlyResult;
			}

			const config = getConfig();
			const executionMeta = getWriteExecutionMeta(
				context,
				writeExecutionMetaByToolCallId,
			);
			return renderWriteDiffResult(
				content,
				{
					expanded: options.expanded,
					filePath: getToolPathArg(context?.args),
					previousContent: executionMeta?.previousContent,
					fileExistedBeforeWrite: executionMeta?.fileExistedBeforeWrite ?? false,
				},
				config,
				theme,
				fallbackText,
			);
		},
	});

	registerBuiltIn("bash", {
		renderCall(args, theme, context) {
			const config = getConfig();
			return renderBashCall(args, theme, context as never, {
				intentMode: config.bashIntentMode,
				showCommand: config.bashIntentShowCommand,
				maxCommandChars: config.bashCommandMaxChars,
			});
		},
		renderResult(result, options, theme, context) {
			const config = getConfig();
			const details = result.details as BashToolDetails | undefined;
			const rawOutput = extractTextOutput(result);

			// Reuse one Text component across partial updates so the TUI's
			// differential renderer does not fall back to full redraws while bash
			// output streams in (ported from PeachIceTea's fork).
			const carrier = toStateCarrier(context?.state) as Record<string, unknown> | undefined;
			const cachedComponent = carrier?.[BASH_RESULT_STATE_KEY] as Text | undefined;
			let rendered: Text;

			if (options.isPartial) {
				rendered = renderBashLivePreview(rawOutput, options, config, theme, details, cachedComponent);
			} else if (isToolError(result, context)) {
				rendered = renderBashErrorResult(rawOutput, options, config, theme, details, cachedComponent);
			} else if (isBackgroundTaskResult(result, context)) {
				const lines = prepareOutputLines(rawOutput, options);
				const text = lines.length === 0
					? theme.fg("muted", "↳ (no output)")
					: lines.map((line) => theme.fg("toolOutput", sanitizeAnsiForThemedOutput(line))).join("\n");
				rendered = reuseTextComponent(text, cachedComponent);
			} else {
				const lines = prepareOutputLines(rawOutput, options);

				if (lines.length === 0) {
					let text = formatBashNoOutputLine(getStringField(context?.args, "command"), theme);
					if (config.showTruncationHints) {
						text += formatBashTruncationHints(details, theme);
					}
					rendered = reuseTextComponent(text, cachedComponent);
				} else if (config.bashOutputMode === "summary") {
					if (options.expanded) {
						const maxLines = getExpandedPreviewLineLimit(lines, config);
						rendered = renderBashPreviewWithHints(lines, maxLines, config, theme, options, details, cachedComponent);
					} else {
						let summary = formatBashSummary(
							lines,
							details,
							theme,
							config.showTruncationHints,
						);
						summary += formatExpandHint(theme);
						if (config.showTruncationHints) {
							summary += formatBashTruncationHints(details, theme);
						}
						rendered = reuseTextComponent(summary, cachedComponent);
					}
				} else if (config.bashOutputMode === "preview") {
					const maxLines = options.expanded
						? getExpandedPreviewLineLimit(lines, config)
						: config.previewLines;
					rendered = renderBashPreviewWithHints(lines, maxLines, config, theme, options, details, cachedComponent);
				} else if (!options.expanded && config.bashCollapsedLines === 0) {
					let hidden = theme.fg("muted", "↳ output hidden");
					if (config.showTruncationHints) {
						hidden += formatBashTruncationHints(details, theme);
					}
					rendered = reuseTextComponent(hidden, cachedComponent);
				} else {
					const maxLines = options.expanded
						? lines.length
						: config.bashCollapsedLines;
					let text = buildPreviewText(lines, maxLines, theme, options.expanded);
					if (config.showTruncationHints) {
						text += formatBashTruncationHints(details, theme);
					}
					rendered = reuseTextComponent(text, cachedComponent);
				}
			}

			if (carrier) {
				carrier[BASH_RESULT_STATE_KEY] = rendered;
			}
			return rendered;
		},
	});

	return capturedBuiltInRenderers;
}
