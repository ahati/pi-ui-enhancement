import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderWriteDiffResult } from "../diff-renderer.js";
import {
	readWorkspaceUtf8File,
	type PendingDiffPreviewData,
	type ReadWorkspaceOptions,
} from "../pending-diff-preview.js";
import { toRecord } from "../tool-metadata.js";
import type { ToolDisplayConfig } from "../types.js";
import {
	WRITE_EXECUTION_META_LIMIT,
	WRITE_EXECUTION_META_STATE_KEY,
	type RenderTheme,
	type ToolRenderContextLike,
	type WriteExecutionMeta,
} from "./types.js";

export function toStateRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

export function captureExistingWriteContent(
	cwd: string,
	rawPath: unknown,
	options?: ReadWorkspaceOptions,
): { existed: boolean; content?: string } {
	if (typeof rawPath !== "string" || !rawPath.trim()) {
		return { existed: false };
	}

	const existing = readWorkspaceUtf8File(cwd, rawPath, options);
	return {
		existed: existing.exists,
		content: existing.content,
	};
}

export function recordWriteExecutionMeta(
	pendingMetaByToolCallId: Map<string, WriteExecutionMeta>,
	toolCallId: string,
	meta: WriteExecutionMeta,
): void {
	pendingMetaByToolCallId.delete(toolCallId);
	pendingMetaByToolCallId.set(toolCallId, meta);

	while (pendingMetaByToolCallId.size > WRITE_EXECUTION_META_LIMIT) {
		const oldestToolCallId: string | undefined = pendingMetaByToolCallId.keys().next().value as string | undefined;
		if (oldestToolCallId === undefined) {
			return;
		}
		pendingMetaByToolCallId.delete(oldestToolCallId);
	}
}

export function clearWriteExecutionMeta(
	pendingMetaByToolCallId: Map<string, WriteExecutionMeta>,
): void {
	pendingMetaByToolCallId.clear();
}

export function getWriteExecutionMeta(
	context: ToolRenderContextLike | undefined,
	pendingMetaByToolCallId: Map<string, WriteExecutionMeta>,
): WriteExecutionMeta | undefined {
	if (!context) {
		return undefined;
	}

	const carrier = toStateRecord(context.state);
	const existing = carrier
		? toRecord(carrier[WRITE_EXECUTION_META_STATE_KEY])
		: undefined;
	if (existing && Object.keys(existing).length > 0) {
		return existing as unknown as WriteExecutionMeta;
	}

	if (!context.toolCallId) {
		return undefined;
	}

	const pending = pendingMetaByToolCallId.get(context.toolCallId);
	if (!pending) {
		return undefined;
	}

	if (carrier) {
		const storedMeta: WriteExecutionMeta = { ...pending };
		carrier[WRITE_EXECUTION_META_STATE_KEY] = storedMeta;
		pendingMetaByToolCallId.delete(context.toolCallId);
		return storedMeta;
	}

	return pending;
}

export interface PendingDiffPreviewState {
	key?: string;
	data?: PendingDiffPreviewData;
}

export function getPendingDiffPreviewState(
	context: ToolRenderContextLike | undefined,
	stateKey: string,
): PendingDiffPreviewState | undefined {
	const carrier = toStateRecord(context?.state);
	if (!carrier) {
		return undefined;
	}

	const current = carrier[stateKey];
	if (current && typeof current === "object" && !Array.isArray(current)) {
		return current as PendingDiffPreviewState;
	}

	const next: PendingDiffPreviewState = {};
	carrier[stateKey] = next;
	return next;
}

export function resolvePendingDiffPreview(
	context: ToolRenderContextLike | undefined,
	stateKey: string,
	previewKey: string | undefined,
	compute: () => PendingDiffPreviewData | undefined,
): PendingDiffPreviewData | undefined {
	const previewState = getPendingDiffPreviewState(context, stateKey);
	if (!previewState) {
		return compute();
	}

	if (previewState.key !== previewKey) {
		previewState.key = previewKey;
		previewState.data = previewKey ? compute() : undefined;
	}

	return previewState.data;
}

export function buildPendingDiffCallComponent(
	summaryText: string,
	previewData: PendingDiffPreviewData | undefined,
	context: ToolRenderContextLike | undefined,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text | Container {
	if (!context?.isPartial || !previewData) {
		return new Text(summaryText, 0, 0);
	}

	const container = new Container();
	container.addChild(new Text(summaryText, 0, 0));
	container.addChild(new Spacer(1));

	if (previewData.notice || typeof previewData.nextContent !== "string") {
		container.addChild(new Text(theme.fg("warning", previewData.notice || "Preview unavailable."), 0, 0));
		return container;
	}

	container.addChild(
		renderWriteDiffResult(
			previewData.nextContent,
			{
				expanded: context.expanded === true,
				filePath: previewData.filePath,
				previousContent: previewData.previousContent,
				fileExistedBeforeWrite: previewData.fileExistedBeforeWrite,
				headerLabel: previewData.headerLabel,
			},
			config,
			theme,
			"",
		),
	);
	return container;
}
