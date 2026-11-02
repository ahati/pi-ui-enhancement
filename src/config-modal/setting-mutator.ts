import { normalizeToolDisplayConfig } from "../config-store.js";
import {
	getToolDisplayPresetConfig,
	parseToolDisplayPreset,
	type ToolDisplayPreset,
} from "../presets.js";
import { CUSTOM_TOOL_OVERRIDE_WILDCARD, type ToolDisplayConfig } from "../types.js";
import { DIFF_COLOR_PRESETS } from "./inspector-definitions.js";

export function parseNumber(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

export function applyPreset(preset: ToolDisplayPreset, currentConfig?: ToolDisplayConfig): ToolDisplayConfig {
	const presetConfig = getToolDisplayPresetConfig(preset);
	return currentConfig
		? {
			...presetConfig,
			debug: currentConfig.debug,
			enabled: currentConfig.enabled,
			// Diff styling is user taste; presets must not wipe it.
			diffAddedBg: currentConfig.diffAddedBg,
			diffRemovedBg: currentConfig.diffRemovedBg,
			diffAddedEmphasisBg: currentConfig.diffAddedEmphasisBg,
			diffRemovedEmphasisBg: currentConfig.diffRemovedEmphasisBg,
			diffSyntaxHighlighting: currentConfig.diffSyntaxHighlighting,
		}
		: presetConfig;
}

export function applySetting(config: ToolDisplayConfig, id: string, value: string): ToolDisplayConfig {
	switch (id) {
		case "enabled":
			return {
				...config,
				enabled: value === "on",
			};
		case "preset": {
			const parsed = parseToolDisplayPreset(value);
			return parsed ? applyPreset(parsed, config) : config;
		}
		case "enableNativeUserMessageBox":
			return {
				...config,
				enableNativeUserMessageBox: value === "on",
			};
		case "enableShikiCodeBlocks":
			return {
				...config,
				enableShikiCodeBlocks: value === "on",
			};
		case "formatCodeBlocks":
			return {
				...config,
				formatCodeBlocks: value === "on",
			};
		case "readOutputMode":
			return {
				...config,
				readOutputMode: value as ToolDisplayConfig["readOutputMode"],
			};
		case "searchOutputMode":
			return {
				...config,
				searchOutputMode: value as ToolDisplayConfig["searchOutputMode"],
			};
		case "mcpOutputMode":
			return {
				...config,
				mcpOutputMode: value as ToolDisplayConfig["mcpOutputMode"],
			};
		case "codemodeOutputMode":
			return normalizeToolDisplayConfig({ ...config, codemodeOutputMode: value });
		case "codemodeShowFileDiffs":
			return {
				...config,
				codemodeShowFileDiffs: value === "on",
			};
		case "decorateAllTools":
			return normalizeToolDisplayConfig({
				...config,
				customToolOverrides: {
					...config.customToolOverrides,
					[CUSTOM_TOOL_OVERRIDE_WILDCARD]: {
						...config.customToolOverrides[CUSTOM_TOOL_OVERRIDE_WILDCARD],
						enabled: value === "on",
						kind: "generic",
						outputMode: config.customToolOverrides[CUSTOM_TOOL_OVERRIDE_WILDCARD]?.outputMode ?? "summary",
					},
				},
			});
		case "previewLines":
			return {
				...config,
				previewLines: parseNumber(value, config.previewLines),
			};
		case "bashOutputMode":
			return {
				...config,
				bashOutputMode: value as ToolDisplayConfig["bashOutputMode"],
			};
		case "bashCollapsedLines":
			return {
				...config,
				bashCollapsedLines: parseNumber(value, config.bashCollapsedLines),
			};
		case "bashIntentMode":
			return {
				...config,
				bashIntentMode: value as ToolDisplayConfig["bashIntentMode"],
			};
		case "bashIntentShowCommand":
			return {
				...config,
				bashIntentShowCommand: value === "on",
			};
		case "bashCommandMaxChars":
			return {
				...config,
				bashCommandMaxChars: parseNumber(value, config.bashCommandMaxChars),
			};
		case "diffViewMode":
			return {
				...config,
				diffViewMode: value as ToolDisplayConfig["diffViewMode"],
			};
		case "diffIndicatorMode":
			return {
				...config,
				diffIndicatorMode: value as ToolDisplayConfig["diffIndicatorMode"],
			};
		case "diffSyntaxHighlighting":
			return {
				...config,
				diffSyntaxHighlighting: value as ToolDisplayConfig["diffSyntaxHighlighting"],
			};
		case "diffColors": {
			const preset = DIFF_COLOR_PRESETS.find((candidate) => candidate.id === value);
			if (!preset) {
				return config;
			}
			return { ...config, ...preset.colors };
		}
		case "allowExternalDiffPreviews":
			return {
				...config,
				allowExternalDiffPreviews: value === "on",
			};
		default:
			return config;
	}
}
