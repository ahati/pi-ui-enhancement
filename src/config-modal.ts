import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ModalOverlayOptions, ToolDisplayConfigController } from "./config-modal/types.js";
import { buildInspectorSettings } from "./config-modal/inspector-definitions.js";
import { applySetting } from "./config-modal/setting-mutator.js";
import { handleToolDisplayArgs } from "./config-modal/command-args.js";

export type {
	DiffColorPreset,
	ToolDisplayConfigController,
	ModalOverlayOptions,
} from "./config-modal/types.js";
export {
	DIFF_COLOR_PRESETS,
	describeDiffColorSelection,
	isDecorateAllToolsEnabled,
	buildInspectorSettings,
} from "./config-modal/inspector-definitions.js";
export {
	applyPreset,
	applySetting,
} from "./config-modal/setting-mutator.js";
export {
	toOnOff,
	toolRenderingSummary,
	summarizeConfig,
	extractScopeFlag,
	handleToolDisplayArgs,
	PRESET_COMMAND_HINT,
} from "./config-modal/command-args.js";

export function resolveResponsiveOverlayOptions(): ModalOverlayOptions {
	const terminalWidth =
		typeof process.stdout.columns === "number" && Number.isFinite(process.stdout.columns)
			? process.stdout.columns
			: 120;
	const terminalHeight =
		typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows)
			? process.stdout.rows
			: 36;

	const margin = 1;
	const availableWidth = Math.max(72, terminalWidth - margin * 2);
	const preferredWidth = terminalWidth >= 170 ? 128 : terminalWidth >= 145 ? 118 : terminalWidth >= 120 ? 106 : 92;
	const width = Math.max(72, Math.min(preferredWidth, availableWidth));

	const availableHeight = Math.max(14, terminalHeight - margin * 2);
	const preferredHeight = Math.max(14, Math.floor(terminalHeight * 0.78));
	const maxHeight = Math.min(preferredHeight, availableHeight);

	return {
		anchor: "center",
		width,
		maxHeight,
		margin,
	};
}

export async function openSettingsModal(ctx: ExtensionCommandContext, controller: ToolDisplayConfigController): Promise<void> {
	const overlayOptions = resolveResponsiveOverlayOptions();
	const capabilities = controller.getCapabilities();

	const [{ ZellijModal }, { SplitPaneInspectorModal }] = await Promise.all([
		import("./zellij-modal.js"),
		import("./settings-inspector-modal.js"),
	]);

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const inspector = new SplitPaneInspectorModal(
				{
					getSettings: () => buildInspectorSettings(controller.getConfig(), capabilities, controller.getConfigPath?.()),
					onChange: (id, newValue) => {
						const next = applySetting(controller.getConfig(), id, newValue);
						controller.setConfig(next, ctx);
					},
					onClose: () => done(),
				},
				theme,
			);

			const modal = new ZellijModal(
				inspector,
				{
					borderStyle: "square",
					padding: 0,
					titleBar: {},
					overlay: overlayOptions,
				},
				theme,
			);

			return {
				render: (width: number) => modal.renderModal(width).lines,
				invalidate: () => modal.invalidate(),
				handleInput(data: string) {
					modal.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true, overlayOptions },
	);
}

export async function runToolDisplayCommandHandler(
	args: string,
	ctx: ExtensionCommandContext,
	controller: ToolDisplayConfigController,
): Promise<void> {
	if (handleToolDisplayArgs(args, ctx, controller)) {
		return;
	}

	if (!ctx.hasUI) {
		ctx.ui.notify("/tool-display requires interactive TUI mode.", "warning");
		return;
	}

	await openSettingsModal(ctx, controller);
}

export function registerToolDisplayCommand(pi: ExtensionAPI, controller: ToolDisplayConfigController): void {
	pi.registerCommand("tool-display", {
		description: "Configure tool output rendering (OpenCode-style)",
		handler: async (args, ctx) => {
			await runToolDisplayCommandHandler(args, ctx, controller);
		},
	});
}
