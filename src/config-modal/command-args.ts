import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayCapabilities } from "../capabilities.js";
import type { ToolDisplayConfigScope } from "../config-store.js";
import {
	detectToolDisplayPreset,
	parseToolDisplayPreset,
	TOOL_DISPLAY_PRESETS,
} from "../presets.js";
import type { ToolDisplayConfig } from "../types.js";
import type { ToolDisplayConfigController } from "./types.js";
import { applyPreset } from "./setting-mutator.js";
import { describeDiffColorSelection } from "./inspector-definitions.js";

export const PRESET_COMMAND_HINT = TOOL_DISPLAY_PRESETS.join("|");

export function toOnOff(value: boolean): string {
	return value ? "on" : "off";
}

export function toolRenderingSummary(config: ToolDisplayConfig): string {
	const disabled = config.disableEnhancedToolRender;
	return `read:${toOnOff(!disabled.read)},grep:${toOnOff(!disabled.grep)},find:${toOnOff(!disabled.find)},ls:${toOnOff(!disabled.ls)},bash:${toOnOff(!disabled.bash)},edit:${toOnOff(!disabled.edit)},write:${toOnOff(!disabled.write)}`;
}

export function summarizeConfig(config: ToolDisplayConfig, capabilities: ToolDisplayCapabilities): string {
	const preset = detectToolDisplayPreset(config);
	const parts = [
		`enabled=${toOnOff(config.enabled)}`,
		`preset=${preset}`,
		`render={${toolRenderingSummary(config)}}`,
		`userBox=${toOnOff(config.enableNativeUserMessageBox)}`,
		`shiki=${toOnOff(config.enableShikiCodeBlocks)}`,
		`codeBox=${toOnOff(config.formatCodeBlocks)}`,
		`shikiTheme=${config.shikiCodeBlockTheme}`,
		`read=${config.readOutputMode}`,
		`search=${config.searchOutputMode}`,
		`codemode=${config.codemodeOutputMode}`,
		`preview=${config.previewLines}`,
		`expandedMax=${config.expandedPreviewMaxLines}`,
		`bash=${config.bashOutputMode}`,
		`bashLines=${config.bashCollapsedLines}`,
		`bashIntent=${config.bashIntentMode}`,
		`diff=${config.diffViewMode}/${config.diffIndicatorMode}@${config.diffSplitMinWidth}`,
		`diffLines=${config.diffCollapsedLines}`,
		`diffWrap=${toOnOff(config.diffWordWrap)}`,
		`diffHl=${config.diffSyntaxHighlighting}`,
		`diffColors=${describeDiffColorSelection(config)}`,
	];

	if (capabilities.hasMcpTooling) {
		parts.push(`mcp=${config.mcpOutputMode}`);
	} else {
		parts.push("mcp=auto-hidden");
	}

	if (capabilities.hasRtkOptimizer) {
		parts.push(`rtkHints=${toOnOff(config.showRtkCompactionHints)}`);
	} else {
		parts.push("rtkHints=auto-off");
	}

	return parts.join(", ");
}

export function extractScopeFlag(raw: string): { command: string; scope?: ToolDisplayConfigScope } {
	const tokens = raw.split(/\s+/).filter(Boolean);
	let scope: ToolDisplayConfigScope | undefined;
	const commandTokens: string[] = [];

	for (const token of tokens) {
		const normalized = token.toLowerCase();
		if (normalized === "--project") {
			scope = "project";
			continue;
		}
		if (normalized === "--global") {
			scope = "global";
			continue;
		}
		if (normalized === "--effective") {
			scope = undefined;
			continue;
		}
		commandTokens.push(token);
	}

	return { command: commandTokens.join(" "), scope };
}

export function handleToolDisplayArgs(args: string, ctx: ExtensionCommandContext, controller: ToolDisplayConfigController): boolean {
	const raw = args.trim();
	if (!raw) {
		return false;
	}

	const parsedArgs = extractScopeFlag(raw);
	const normalized = parsedArgs.command.toLowerCase();
	const setOptions = parsedArgs.scope ? { scope: parsedArgs.scope } : undefined;

	if (normalized === "show") {
		ctx.ui.notify(
			`tool-display: ${summarizeConfig(controller.getConfig(), controller.getCapabilities())}`,
			"info",
		);
		return true;
	}

	if (normalized === "reset") {
		const saved = controller.setConfig(applyPreset("opencode", controller.getConfig()), ctx, setOptions);
		if (saved !== false) {
			ctx.ui.notify("Tool display preset reset to opencode.", "info");
		}
		return true;
	}

	if (normalized.startsWith("preset ")) {
		const candidate = normalized.slice("preset ".length).trim();
		const preset = parseToolDisplayPreset(candidate);
		if (!preset) {
			ctx.ui.notify(`Unknown preset. Use: /tool-display preset ${PRESET_COMMAND_HINT}`, "warning");
			return true;
		}

		const saved = controller.setConfig(applyPreset(preset, controller.getConfig()), ctx, setOptions);
		if (saved !== false) {
			ctx.ui.notify(`Tool display preset set to ${preset}.`, "info");
		}
		return true;
	}

	ctx.ui.notify(`Usage: /tool-display [show|reset|preset ${PRESET_COMMAND_HINT}]`, "warning");
	return true;
}
