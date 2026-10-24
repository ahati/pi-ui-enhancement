import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayCapabilities } from "./capabilities.js";
import {
	getToolDisplayConfigPath,
	normalizeToolDisplayConfig,
	type ToolDisplayConfigScope,
} from "./config-store.js";
import {
	detectToolDisplayPreset,
	getToolDisplayPresetConfig,
	parseToolDisplayPreset,
	TOOL_DISPLAY_PRESETS,
	type ToolDisplayPreset,
} from "./presets.js";
import { shortenPath } from "./render-utils.js";
import type { InspectorSettingItem } from "./settings-inspector-modal.js";
import { CUSTOM_TOOL_OVERRIDE_WILDCARD, type ToolDisplayConfig } from "./types.js";

interface DiffColorPreset {
	id: string;
	colors: Pick<
		ToolDisplayConfig,
		"diffAddedBg" | "diffRemovedBg" | "diffAddedEmphasisBg" | "diffRemovedEmphasisBg"
	>;
}

/** Named row-background palettes for the cycling modal selector; "theme" keeps derived mixes. */
const DIFF_COLOR_PRESETS: readonly DiffColorPreset[] = [
	{ id: "theme", colors: { diffAddedBg: undefined, diffRemovedBg: undefined, diffAddedEmphasisBg: undefined, diffRemovedEmphasisBg: undefined } },
	{ id: "github", colors: { diffAddedBg: "#14351f", diffRemovedBg: "#3a1d20", diffAddedEmphasisBg: "#1d5230", diffRemovedEmphasisBg: "#57262b" } },
	{ id: "contrast", colors: { diffAddedBg: "#1d5230", diffRemovedBg: "#55242b", diffAddedEmphasisBg: "#27703f", diffRemovedEmphasisBg: "#6e3038" } },
];

function describeDiffColorSelection(config: ToolDisplayConfig): string {
	const colorKeys = [
		"diffAddedBg",
		"diffRemovedBg",
		"diffAddedEmphasisBg",
		"diffRemovedEmphasisBg",
	] as const;
	for (const preset of DIFF_COLOR_PRESETS) {
		if (colorKeys.every((key) => config[key] === preset.colors[key])) {
			return preset.id;
		}
	}
	return "custom";
}

function isDecorateAllToolsEnabled(config: ToolDisplayConfig): boolean {
	return config.customToolOverrides[CUSTOM_TOOL_OVERRIDE_WILDCARD]?.enabled === true;
}

interface ToolDisplayConfigController {
	getConfig(): ToolDisplayConfig;
	setConfig(next: ToolDisplayConfig, ctx: ExtensionCommandContext, options?: { scope?: ToolDisplayConfigScope }): boolean | void;
	getCapabilities(): ToolDisplayCapabilities;
	getConfigPath?(): string;
}

interface ModalOverlayOptions {
	anchor: "center";
	width: number;
	maxHeight: number;
	margin: number;
}

const PREVIEW_LINE_VALUES = ["4", "8", "12", "20", "40"] as const;
const BASH_PREVIEW_LINE_VALUES = ["0", "5", "10", "20", "40"] as const;
const BASH_COMMAND_MAX_CHARS_VALUES = ["0", "40", "60", "80", "120", "200"] as const;
const BASH_INTENT_MODE_VALUES = ["off", "render", "render-and-instruct"] as const;
const PRESET_COMMAND_HINT = TOOL_DISPLAY_PRESETS.join("|");

function toOnOff(value: boolean): string {
	return value ? "on" : "off";
}

function toolRenderingSummary(config: ToolDisplayConfig): string {
	const disabled = config.disableEnhancedToolRender;
	return `read:${toOnOff(!disabled.read)},grep:${toOnOff(!disabled.grep)},find:${toOnOff(!disabled.find)},ls:${toOnOff(!disabled.ls)},bash:${toOnOff(!disabled.bash)},edit:${toOnOff(!disabled.edit)},write:${toOnOff(!disabled.write)}`;
}

function summarizeConfig(config: ToolDisplayConfig, capabilities: ToolDisplayCapabilities): string {
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

function parseNumber(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function extractScopeFlag(raw: string): { command: string; scope?: ToolDisplayConfigScope } {
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

function buildAdvancedNotes(
	config: ToolDisplayConfig,
	capabilities: ToolDisplayCapabilities,
	extra: readonly string[],
): string[] {
	const notes = [
		...extra,
		"Manual JSON edits also expose disableEnhancedToolRender.*, expandedPreviewMaxLines, diffSplitMinWidth, diffCollapsedLines, diffIndicatorMode, diffWordWrap, diffAddedBg, diffRemovedBg, diffAddedEmphasisBg, diffRemovedEmphasisBg, and shikiCodeBlockTheme.",
		`Enhanced tool rendering is currently ${toolRenderingSummary(config)} and still applies after /reload.`,
		`Truncation hints are ${toOnOff(config.showTruncationHints)}${capabilities.hasRtkOptimizer ? `; RTK hints are ${toOnOff(config.showRtkCompactionHints)}.` : "."}`,
	];
	return notes;
}

function buildInspectorSettings(
	config: ToolDisplayConfig,
	capabilities: ToolDisplayCapabilities,
	activeConfigPath = getToolDisplayConfigPath(),
): InspectorSettingItem[] {
	const configPath = shortenPath(activeConfigPath);
	const items: InspectorSettingItem[] = [
		{
			id: "enabled",
			label: "Global switch",
			currentValue: toOnOff(config.enabled),
			values: ["on", "off"],
			inspectorTitle: "Global Tool Display Switch",
			inspectorSummary: [
				"Enables or disables all tool-display rendering and tool ownership behavior.",
				"The /tool-display command remains available while disabled so the extension can be enabled again without editing config files.",
			],
			inspectorOptions: [
				"on — enable tool overrides and enhanced rendering",
				"off — keep the package installed but use Pi's default rendering",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Changing this switch is saved immediately and takes effect after /reload.",
			]),
			inspectorPath: configPath,
			searchTerms: ["global", "enabled", "disable", "switch", "reload"],
		},
		{
			id: "preset",
			label: "Preset profile",
			currentValue: detectToolDisplayPreset(config),
			values: TOOL_DISPLAY_PRESETS,
			inspectorTitle: "Preset Profile",
			inspectorSummary: [
				"Determines the overall verbosity and layout of the agent's tool output.",
				"Choosing a preset applies a coherent profile across read, search, MCP, bash, and diff display settings.",
			],
			inspectorOptions: [
				"opencode — strict inline-only tool output",
				"balanced — compact summaries with counts",
				"verbose — larger line previews and more visible bash output",
				"custom — shown automatically when manual overrides no longer match a preset",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Presets reset multiple fields together, so manual JSON tuning is the right place for durable custom combinations.",
			]),
			inspectorPath: configPath,
			searchTerms: ["verbosity", "profile", "layout", "custom", ...TOOL_DISPLAY_PRESETS],
		},
		{
			id: "readOutputMode",
			label: "Read tool output",
			currentValue: config.readOutputMode,
			values: ["hidden", "summary", "preview"],
			inspectorTitle: "Read Tool Output",
			inspectorSummary: [
				"Controls how read results appear inline after the tool call header.",
				"Use hidden for the cleanest transcript, summary for file metrics, or preview when seeing source lines matters in-context.",
			],
			inspectorOptions: [
				"hidden — path and status only",
				"summary — adds compact file metrics",
				"preview — shows the first configured preview lines",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"expandedPreviewMaxLines bounds how many lines can appear after expanding a preview-heavy read result.",
			]),
			inspectorPath: configPath,
			searchTerms: ["file", "source", "preview", "summary", "hidden"],
		},
		{
			id: "searchOutputMode",
			label: "Grep/Find/Ls output",
			currentValue: config.searchOutputMode,
			values: ["hidden", "count", "preview"],
			inspectorTitle: "Grep / Find / Ls Output",
			inspectorSummary: [
				"Controls how search-style tools compress their result sets inside the transcript.",
				"Count mode keeps discovery actions readable while still surfacing how much data the tool matched.",
			],
			inspectorOptions: [
				"hidden — call header only",
				"count — totals only for matches or entries",
				"preview — shows the first configured preview lines",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Preview-heavy search output is most effective when paired with larger previewLines values in custom configurations.",
			]),
			inspectorPath: configPath,
			searchTerms: ["grep", "find", "ls", "matches", "count", "results"],
		},
		{
			id: "codemodeOutputMode",
			label: "Native codemode output",
			currentValue: config.codemodeOutputMode,
			values: ["summary", "calls", "preview"],
			inspectorTitle: "Native codemode output",
			inspectorSummary: [
				"Controls the collapsed view of Pi's native codemode tool.",
				"Expand a tool to see its full script, call trace, and output.",
			],
			inspectorOptions: [
				"summary: script status and call counts only",
				"calls: status summary and nested-call trace",
				"preview: call trace plus output limited by Preview lines",
			],
			inspectorAdvanced: [
				"Preview lines counts terminal rows after wrapping codemode output.",
				"Selections are saved automatically.",
			],
			inspectorPath: configPath,
			searchTerms: ["codemode", "script", "calls", "trace", "summary", "preview"],
		},
	];

	if (capabilities.hasMcpTooling) {
		items.push({
			id: "mcpOutputMode",
			label: "MCP tool output",
			currentValue: config.mcpOutputMode,
			values: ["hidden", "summary", "preview"],
			inspectorTitle: "MCP Tool Output",
			inspectorSummary: [
				"Controls how proxied MCP tool results are compacted when they return text output.",
				"Summary mode is the safest default when you want awareness without flooding the chat pane.",
			],
			inspectorOptions: [
				"hidden — call metadata only",
				"summary — compact line-count summary",
				"preview — shows the first configured preview lines",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"This control appears only when MCP tooling is available in the current Pi session.",
			]),
			inspectorPath: configPath,
			searchTerms: ["mcp", "proxy", "server", "summary", "preview"],
		});
	}

	items.push(
		{
			id: "codemodeShowFileDiffs",
			label: "Codemode file diffs",
			currentValue: toOnOff(config.codemodeShowFileDiffs),
			values: ["on", "off"],
			inspectorTitle: "Codemode File Diffs",
			inspectorSummary: [
				"Shows edit and write diffs captured inside codemode script runs as a File changes section, without adding them to the model's context.",
				"Diffs are display-only, budgeted, and survive session resume via rendering metadata.",
			],
			inspectorOptions: [
				"on — append the File changes section to codemode results",
				"off — keep status, call trace, and output preview only",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Collapsed previews show up to 3 changes and 8 lines each; expand a call for the full diff.",
			]),
			inspectorPath: configPath,
			searchTerms: ["codemode", "diff", "file", "changes", "script"],
		},
		{
			id: "decorateAllTools",
			label: "Decorate all tools",
			currentValue: toOnOff(isDecorateAllToolsEnabled(config)),
			values: ["on", "off"],
			inspectorTitle: "Decorate All Tools",
			inspectorSummary: [
				"Renders every tool call compactly, including third-party extension tools, using the generic compact call line and a collapsed result summary.",
				"Built-in tools (read, grep, find, ls, bash, edit, write), MCP tools, and codemode keep their specialized renderers either way.",
			],
			inspectorOptions: [
				"on — unknown tools get a compact call line and summarized output",
				"off — unknown tools keep their native extension rendering",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				'Stored as customToolOverrides["*"]; add a per-tool entry to override one tool, or set "enabled": false there to exclude it.',
			]),
			inspectorPath: configPath,
			searchTerms: ["decorate", "all", "tools", "generic", "wildcard", "third-party"],
		},
		{
			id: "previewLines",
			label: "Preview lines",
			currentValue: String(config.previewLines),
			values: PREVIEW_LINE_VALUES,
			inspectorTitle: "Preview Lines",
			inspectorSummary: [
				"Sets how many output lines appear in collapsed read, search, MCP, bash, and codemode previews.",
				"Accepted manual range: 1 to 80 lines. The quick selector cycles through a curated set for fast tuning.",
			],
			inspectorOptions: [
				"Lower values keep transcripts dense and skimmable",
				"Higher values surface more source context before expansion",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Pair this with expandedPreviewMaxLines when you want larger expanded previews without making collapsed output noisy.",
			]),
			inspectorPath: configPath,
			searchTerms: ["preview", "lines", "range", "collapsed", "read", "grep", "mcp", "bash"],
		},
		{
			id: "bashOutputMode",
			label: "Bash tool output",
			currentValue: config.bashOutputMode,
			values: ["opencode", "summary", "preview"],
			inspectorTitle: "Bash Tool Output",
			inspectorSummary: [
				"Controls how shell command output is rendered when the command finishes successfully.",
				"The opencode mode keeps command output recognizable while still compressing walls of stdout.",
			],
			inspectorOptions: [
				"opencode — Pi/OpenCode-style collapsed bash view",
				"summary — output count only",
				"preview — uses the shared previewLines setting",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Quiet commands still collapse aggressively, so mode selection matters most on verbose build, test, and script output.",
			]),
			inspectorPath: configPath,
			searchTerms: ["bash", "shell", "stdout", "command", "opencode"],
		},
		{
			id: "bashCollapsedLines",
			label: "Bash collapsed lines",
			currentValue: String(config.bashCollapsedLines),
			values: BASH_PREVIEW_LINE_VALUES,
			inspectorTitle: "Bash Collapsed Lines",
			inspectorSummary: [
				"Sets the inline line budget used specifically by opencode bash mode before expansion.",
				"Accepted manual range: 0 to 80 lines. Setting 0 hides collapsed bash output entirely while keeping the command visible.",
			],
			inspectorOptions: [
				"0 — hide collapsed bash output",
				"5/10/20/40 — progressively larger inline command previews",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"This setting only changes the opencode bash renderer; preview mode continues to use previewLines instead.",
			]),
			inspectorPath: configPath,
			searchTerms: ["bash", "collapsed", "lines", "stdout", "zero"],
		},
		{
			id: "bashIntentMode",
			label: "Bash intent headers",
			currentValue: config.bashIntentMode,
			values: [...BASH_INTENT_MODE_VALUES],
			inspectorTitle: "Bash Intent Headers",
			inspectorSummary: [
				"Renders leading `# intent:` / `# tool:` comment lines as the bash call header instead of the raw command.",
				"The comments are ordinary shell comments: the renderer strips them for display and they are never executed.",
			],
			inspectorOptions: [
				"off — show the raw command in the header",
				"render — comment lines become the header: 🔧 tool · intent",
				"render-and-instruct — render, plus teach the model the convention via the system prompt",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"render-and-instruct appends a guideline to the system prompt; the guideline is injected once and survives chained before_agent_start handlers.",
				"Without a `# tool:` comment the header label falls back to the program derived from the command (wrappers like sudo/cd are skipped).",
			]),
			inspectorPath: configPath,
			searchTerms: ["bash", "intent", "tool", "comment", "header", "command"],
		},
		{
			id: "bashIntentShowCommand",
			label: "Bash intent command suffix",
			currentValue: toOnOff(config.bashIntentShowCommand),
			values: ["off", "on"],
			inspectorTitle: "Bash Intent Command Suffix",
			inspectorSummary: [
				"Appends the stripped command after the rendered intent header on one line, for provenance.",
				"Requires Bash intent headers to be on. Expanding a call with Ctrl+O shows the full command instead, so the command never appears twice.",
			],
			inspectorOptions: [
				"off — header shows only the intent",
				"on — header ends with the muted one-line command",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Line breaks in the command are collapsed to single spaces in the suffix.",
			]),
			inspectorPath: configPath,
			searchTerms: ["bash", "intent", "command", "suffix", "provenance"],
		},
		{
			id: "bashCommandMaxChars",
			label: "Bash command width limit",
			currentValue: String(config.bashCommandMaxChars),
			values: [...BASH_COMMAND_MAX_CHARS_VALUES],
			inspectorTitle: "Bash Command Width Limit",
			inspectorSummary: [
				"Truncates the bash call's displayed command to a single line of at most N characters, with an ellipsis.",
				"Line breaks are collapsed to ` ; ` separators first, so long multi-line commands stop wrapping across many terminal rows.",
			],
			inspectorOptions: [
				"0 — keep the full command (default)",
				"40/60/80/120/200 — progressively shorter one-line limits",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Accepted manual range: 0 to 2000 characters. Applies to the collapsed header regardless of intent mode.",
			]),
			inspectorPath: configPath,
			searchTerms: ["bash", "command", "truncate", "width", "chars", "wrap"],
		},
		{
			id: "diffViewMode",
			label: "Edit diff layout",
			currentValue: config.diffViewMode,
			values: ["auto", "split", "unified"],
			inspectorTitle: "Edit Diff Layout",
			inspectorSummary: [
				"Controls how edit and write diffs are arranged when the extension renders code changes.",
				"Auto mode adapts to terminal width so wide panes get side-by-side diffs while narrow panes stay readable.",
			],
			inspectorOptions: [
				"auto — adaptive layout based on available width",
				"split — force side-by-side diff columns",
				"unified — force a single-column diff",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Manual JSON tuning exposes diffSplitMinWidth, diffCollapsedLines, diffIndicatorMode, and diffWordWrap for more aggressive diff control.",
			]),
			inspectorPath: configPath,
			searchTerms: ["diff", "edit", "write", "split", "unified", "auto"],
		},
		{
			id: "diffIndicatorMode",
			label: "Diff indicators",
			currentValue: config.diffIndicatorMode,
			values: ["bars", "classic", "none"],
			inspectorTitle: "Diff Indicators",
			inspectorSummary: [
				"Controls whether changed diff lines use vertical bars, classic +/- markers, or no indicators at all.",
				"Bars continue across wrapped changed rows, classic markers appear only on the first wrapped row, and none removes the indicator column styling.",
			],
			inspectorOptions: [
				"bars — persistent vertical indicators for changed rows",
				"classic — + / - markers on the first visual row only",
				"none — no diff indicator marker",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Use config.json when you want this indicator preference to remain explicit alongside other diff rendering overrides.",
			]),
			inspectorPath: configPath,
			searchTerms: ["diff", "indicator", "bars", "classic", "none", "marker"],
		},
		{
			id: "diffSyntaxHighlighting",
			label: "Diff syntax highlighting",
			currentValue: config.diffSyntaxHighlighting,
			values: ["shiki", "basic", "off"],
			inspectorTitle: "Diff Syntax Highlighting",
			inspectorSummary: [
				"Controls code coloring inside edit and write diff rows.",
				"Shiki highlights each hunk as a whole block, so multi-line strings, comments, and JSX keep their colors; basic uses Pi's per-line highlighter, which loses cross-line context.",
			],
			inspectorOptions: [
				"shiki — TextMate-grammar highlighting per hunk block (recommended)",
				"basic — Pi's per-line highlighter",
				"off — no syntax colors in diff rows",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Shiki diff highlighting falls back to basic per-line colors for languages outside the bundled grammar set.",
			]),
			inspectorPath: configPath,
			searchTerms: ["diff", "syntax", "highlight", "shiki", "code", "color"],
		},
		{
			id: "diffColors",
			label: "Diff row colors",
			currentValue: describeDiffColorSelection(config),
			values: DIFF_COLOR_PRESETS.map((preset) => preset.id),
			inspectorTitle: "Diff Row Colors",
			inspectorSummary: [
				"Chooses the background tint applied to changed diff lines.",
				"theme derives tints from the active Pi theme (stronger green for added lines, subtle red for removed lines); fixed presets pin explicit hex colors instead.",
			],
			inspectorOptions: [
				"theme — theme-derived tints, adapts to light/dark (recommended)",
				"github — GitHub-dark style fixed tints",
				"contrast — maximum-separation fixed tints",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Custom hex colors can be set via config.json keys diffAddedBg, diffRemovedBg, diffAddedEmphasisBg, and diffRemovedEmphasisBg; the modal reports such states as custom.",
			]),
			inspectorPath: configPath,
			searchTerms: ["diff", "color", "background", "tint", "green", "red", "contrast"],
		},
		{
			id: "allowExternalDiffPreviews",
			label: "External diff previews",
			currentValue: toOnOff(config.allowExternalDiffPreviews),
			values: ["off", "on"],
			inspectorTitle: "Allow External Diff Previews",
			inspectorSummary: [
				"Allows edit and write diff previews for target files located outside the active workspace directory.",
				"When enabled, pending diff previews will read existing target files across the filesystem instead of restricting previews to workspace paths.",
			],
			inspectorOptions: [
				"off — restrict diff previews to target files within the active workspace",
				"on — allow diff previews for target paths anywhere on disk",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"This setting only affects presentation previews rendered by pi-ui-enhancement.",
			]),
			inspectorPath: configPath,
			searchTerms: ["diff", "external", "preview", "workspace", "path", "outside"],
		},
		{
			id: "enableShikiCodeBlocks",
			label: "Shiki code highlighting",
			currentValue: toOnOff(config.enableShikiCodeBlocks),
			values: ["on", "off"],
			inspectorTitle: "Shiki Code Highlighting",
			inspectorSummary: [
				"Toggles TextMate grammar-backed Shiki highlighting for markdown code fences in assistant, user, and custom markdown messages.",
				"When Shiki cannot load a language, rendering falls back to Pi's built-in markdown highlighter automatically.",
			],
			inspectorOptions: [
				"on — use Shiki's TextMate renderer for known fenced languages",
				"off — keep Pi's built-in code fence highlighting",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Set shikiCodeBlockTheme in config.json to github-dark, github-light, dark-plus, light-plus, min-dark, min-light, one-dark-pro, vitesse-dark, or vitesse-light.",
			]),
			inspectorPath: configPath,
			searchTerms: ["shiki", "textmate", "syntax", "highlight", "code", "fence"],
		},
		{
			id: "formatCodeBlocks",
			label: "Code block box",
			currentValue: toOnOff(config.formatCodeBlocks),
			values: ["on", "off"],
			inspectorTitle: "Code Block Box Formatting",
			inspectorSummary: [
				"Toggles the rounded bordered layout for markdown code blocks.",
				"This only changes transcript presentation; it does not alter stored message content or model context.",
			],
			inspectorOptions: [
				"on — render fences as compact bordered code panels with a language label",
				"off — keep classic triple-backtick fence formatting",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"Code block box formatting can be used with Shiki on or off; highlighting falls back to Pi's built-in renderer when needed.",
			]),
			inspectorPath: configPath,
			searchTerms: ["code", "block", "box", "format", "fence", "markdown"],
		},
		{
			id: "enableNativeUserMessageBox",
			label: "Native user message box",
			currentValue: toOnOff(config.enableNativeUserMessageBox),
			values: ["on", "off"],
			inspectorTitle: "Native User Message Box",
			inspectorSummary: [
				"Toggles the bordered native renderer used for user prompts inside the Pi transcript.",
				"Keep it on when you want clearer message separation, or turn it off to fall back to Pi's default user message rendering.",
			],
			inspectorOptions: [
				"on — bordered native user prompt box",
				"off — default Pi prompt rendering",
			],
			inspectorAdvanced: buildAdvancedNotes(config, capabilities, [
				"This switch only affects presentation. It does not change stored prompts, markdown handling, or tool behavior.",
			]),
			inspectorPath: configPath,
			searchTerms: ["user", "message", "box", "prompt", "native"],
		},
	);

	return items;
}

function applyPreset(preset: ToolDisplayPreset, currentConfig?: ToolDisplayConfig): ToolDisplayConfig {
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

function applySetting(config: ToolDisplayConfig, id: string, value: string): ToolDisplayConfig {
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

function resolveResponsiveOverlayOptions(): ModalOverlayOptions {
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
