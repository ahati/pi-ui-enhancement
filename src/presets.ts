import { cloneCustomToolOverrides } from "./config-store.js";
import {
	DEFAULT_TOOL_DISPLAY_CONFIG,
	TOOL_DISPLAY_PRESET_IGNORED_CONFIG_KEYS,
	TOOL_DISPLAY_SCALAR_CONFIG_KEYS,
	type CustomToolOverrideConfig,
	type ToolDisplayConfig,
	type ToolDisplayScalarConfigKey,
} from "./types.js";

export const TOOL_DISPLAY_PRESETS = ["opencode", "balanced", "verbose"] as const;
export type ToolDisplayPreset = (typeof TOOL_DISPLAY_PRESETS)[number];

const TOOL_DISPLAY_PRESET_CONFIGS: Record<ToolDisplayPreset, ToolDisplayConfig> = {
	opencode: {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		disableEnhancedToolRender: { ...DEFAULT_TOOL_DISPLAY_CONFIG.disableEnhancedToolRender },
	},
	balanced: {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		disableEnhancedToolRender: { ...DEFAULT_TOOL_DISPLAY_CONFIG.disableEnhancedToolRender },
		readOutputMode: "summary",
		searchOutputMode: "count",
		mcpOutputMode: "summary",
		bashOutputMode: "summary",
	},
	verbose: {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		disableEnhancedToolRender: { ...DEFAULT_TOOL_DISPLAY_CONFIG.disableEnhancedToolRender },
		readOutputMode: "preview",
		searchOutputMode: "preview",
		mcpOutputMode: "preview",
		codemodeOutputMode: "preview",
		bashOutputMode: "preview",
		previewLines: 12,
		bashCollapsedLines: 20,
	},
};

function disableEnhancedToolRenderEqual(a: ToolDisplayConfig, b: ToolDisplayConfig): boolean {
	return (
		a.disableEnhancedToolRender.read === b.disableEnhancedToolRender.read &&
		a.disableEnhancedToolRender.grep === b.disableEnhancedToolRender.grep &&
		a.disableEnhancedToolRender.find === b.disableEnhancedToolRender.find &&
		a.disableEnhancedToolRender.ls === b.disableEnhancedToolRender.ls &&
		a.disableEnhancedToolRender.bash === b.disableEnhancedToolRender.bash &&
		a.disableEnhancedToolRender.edit === b.disableEnhancedToolRender.edit &&
		a.disableEnhancedToolRender.write === b.disableEnhancedToolRender.write
	);
}

function customToolOverridesEqual(a: ToolDisplayConfig, b: ToolDisplayConfig): boolean {
	const aEntries = Object.entries(a.customToolOverrides).sort(([left], [right]) => left.localeCompare(right));
	const bEntries = Object.entries(b.customToolOverrides).sort(([left], [right]) => left.localeCompare(right));
	if (aEntries.length !== bEntries.length) {
		return false;
	}

	return aEntries.every(([toolName, override], index) => {
		const [otherToolName, otherOverride] = bEntries[index];
		return (
			toolName === otherToolName &&
			override.enabled === otherOverride.enabled &&
			override.kind === otherOverride.kind &&
			override.outputMode === otherOverride.outputMode
		);
	});
}

function isPresetIgnoredConfigKey(key: ToolDisplayScalarConfigKey): boolean {
	return (TOOL_DISPLAY_PRESET_IGNORED_CONFIG_KEYS as ReadonlyArray<ToolDisplayScalarConfigKey>).includes(key);
}

function scalarConfigEqual(a: ToolDisplayConfig, b: ToolDisplayConfig): boolean {
	return TOOL_DISPLAY_SCALAR_CONFIG_KEYS.every((key) =>
		isPresetIgnoredConfigKey(key) || a[key] === b[key]
	);
}

function configsEqual(a: ToolDisplayConfig, b: ToolDisplayConfig): boolean {
	return (
		disableEnhancedToolRenderEqual(a, b) &&
		customToolOverridesEqual(a, b) &&
		scalarConfigEqual(a, b)
	);
}

export function getToolDisplayPresetConfig(preset: ToolDisplayPreset): ToolDisplayConfig {
	const config = TOOL_DISPLAY_PRESET_CONFIGS[preset];
	return {
		...config,
		disableEnhancedToolRender: { ...config.disableEnhancedToolRender },
		customToolOverrides: cloneCustomToolOverrides(config.customToolOverrides),
	};
}

export function detectToolDisplayPreset(config: ToolDisplayConfig): ToolDisplayPreset | "custom" {
	for (const preset of TOOL_DISPLAY_PRESETS) {
		if (configsEqual(config, TOOL_DISPLAY_PRESET_CONFIGS[preset])) {
			return preset;
		}
	}
	return "custom";
}

export function parseToolDisplayPreset(raw: string): ToolDisplayPreset | undefined {
	const normalized = raw.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	return TOOL_DISPLAY_PRESETS.find((preset) => preset === normalized);
}
