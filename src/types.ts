export const READ_OUTPUT_MODES = ["hidden", "summary", "preview"] as const;
export const SEARCH_OUTPUT_MODES = ["hidden", "count", "preview"] as const;
export const MCP_OUTPUT_MODES = ["hidden", "summary", "preview"] as const;
export const CUSTOM_TOOL_OVERRIDE_KINDS = ["generic", "mcp"] as const;
/** Wildcard key in customToolOverrides: decorates every tool without an exact-name entry. */
export const CUSTOM_TOOL_OVERRIDE_WILDCARD = "*";
export const CUSTOM_TOOL_OUTPUT_MODES = ["hidden", "summary", "preview"] as const;
export const BASH_OUTPUT_MODES = ["opencode", "summary", "preview"] as const;
export const BASH_INTENT_MODES = ["off", "render", "render-and-instruct"] as const;
export const DIFF_VIEW_MODES = ["auto", "split", "unified"] as const;
export const DIFF_INDICATOR_MODES = ["bars", "classic", "none"] as const;
export const DIFF_SYNTAX_HIGHLIGHTING_MODES = ["shiki", "basic", "off"] as const;
export const SHIKI_CODE_BLOCK_THEMES = [
	"github-dark",
	"github-light",
	"dark-plus",
	"light-plus",
	"min-dark",
	"min-light",
	"one-dark-pro",
	"vitesse-dark",
	"vitesse-light",
] as const;

export type ReadOutputMode = (typeof READ_OUTPUT_MODES)[number];
export type SearchOutputMode = (typeof SEARCH_OUTPUT_MODES)[number];
export type McpOutputMode = (typeof MCP_OUTPUT_MODES)[number];
export type CustomToolOverrideKind = (typeof CUSTOM_TOOL_OVERRIDE_KINDS)[number];
export type CustomToolOutputMode = (typeof CUSTOM_TOOL_OUTPUT_MODES)[number];
export type BashOutputMode = (typeof BASH_OUTPUT_MODES)[number];
export type BashIntentMode = (typeof BASH_INTENT_MODES)[number];
export type DiffViewMode = (typeof DIFF_VIEW_MODES)[number];
export type DiffIndicatorMode = (typeof DIFF_INDICATOR_MODES)[number];
export type DiffSyntaxHighlightingMode = (typeof DIFF_SYNTAX_HIGHLIGHTING_MODES)[number];
export type ShikiCodeBlockTheme = (typeof SHIKI_CODE_BLOCK_THEMES)[number];

export const BUILT_IN_TOOL_OVERRIDE_NAMES = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"edit",
	"write",
] as const;

export type BuiltInToolOverrideName = (typeof BUILT_IN_TOOL_OVERRIDE_NAMES)[number];

export interface DisableEnhancedToolRender {
	/** true = disable tool-display rendering for this built-in (native rendering shows instead). */
	read: boolean;
	grep: boolean;
	find: boolean;
	ls: boolean;
	bash: boolean;
	edit: boolean;
	write: boolean;
}

/**
 * @deprecated Legacy ownership-flag shape (inverted semantics). Kept only for
 * external consumers; the config now uses `DisableEnhancedToolRender`.
 */
export type ToolOverrideOwnership = DisableEnhancedToolRender;

export interface CustomToolOverrideConfig {
	enabled: boolean;
	kind: CustomToolOverrideKind;
	outputMode: CustomToolOutputMode;
	preserveCallRenderer?: boolean;
}

export interface ToolDisplayConfig {
	enabled: boolean;
	debug: boolean;
	disableEnhancedToolRender: DisableEnhancedToolRender;
	customToolOverrides: Record<string, CustomToolOverrideConfig>;
	enableNativeUserMessageBox: boolean;
	enableShikiCodeBlocks: boolean;
	formatCodeBlocks: boolean;
	shikiCodeBlockTheme: ShikiCodeBlockTheme;
	readOutputMode: ReadOutputMode;
	searchOutputMode: SearchOutputMode;
	mcpOutputMode: McpOutputMode;
	codemodeOutputMode: "summary" | "calls" | "preview";
	/** Show edit/write diffs captured inside codemode runs (pi-codemode-diff feature). */
	codemodeShowFileDiffs: boolean;
	previewLines: number;
	expandedPreviewMaxLines: number;
	bashOutputMode: BashOutputMode;
	bashCollapsedLines: number;
	bashCommandMaxChars: number;
	bashIntentMode: BashIntentMode;
	bashIntentShowCommand: boolean;
	diffViewMode: DiffViewMode;
	diffIndicatorMode: DiffIndicatorMode;
	diffSplitMinWidth: number;
	diffCollapsedLines: number;
	diffWordWrap: boolean;
	/** Explicit diff row/emphasis backgrounds as #RRGGBB; undefined keeps theme-derived mixes. */
	diffAddedBg?: string;
	diffRemovedBg?: string;
	diffAddedEmphasisBg?: string;
	diffRemovedEmphasisBg?: string;
	/** Code coloring inside edit/write diffs: bundled Shiki (block-level), pi's basic per-line highlighter, or none. */
	diffSyntaxHighlighting: DiffSyntaxHighlightingMode;
	allowExternalDiffPreviews: boolean;
	showTruncationHints: boolean;
	showRtkCompactionHints: boolean;
}

export const TOOL_DISPLAY_SCALAR_CONFIG_KEYS = [
	"debug",
	"enableNativeUserMessageBox",
	"readOutputMode",
	"searchOutputMode",
	"mcpOutputMode",
	"codemodeOutputMode",
	"codemodeShowFileDiffs",
	"previewLines",
	"expandedPreviewMaxLines",
	"bashOutputMode",
	"bashCollapsedLines",
	"bashCommandMaxChars",
	"bashIntentMode",
	"bashIntentShowCommand",
	"diffViewMode",
	"diffIndicatorMode",
	"diffSplitMinWidth",
	"diffCollapsedLines",
	"diffWordWrap",
	"diffAddedBg",
	"diffRemovedBg",
	"diffAddedEmphasisBg",
	"diffRemovedEmphasisBg",
	"diffSyntaxHighlighting",
	"allowExternalDiffPreviews",
	"showTruncationHints",
	"showRtkCompactionHints",
] as const satisfies ReadonlyArray<Exclude<keyof ToolDisplayConfig, "disableEnhancedToolRender" | "customToolOverrides">>;

export type ToolDisplayScalarConfigKey = (typeof TOOL_DISPLAY_SCALAR_CONFIG_KEYS)[number];

export const TOOL_DISPLAY_PRESET_IGNORED_CONFIG_KEYS = [
	"debug",
	// Colors are user taste; applying a preset must not wipe them.
	"diffAddedBg",
	"diffRemovedBg",
	"diffAddedEmphasisBg",
	"diffRemovedEmphasisBg",
] as const satisfies ReadonlyArray<ToolDisplayScalarConfigKey>;

export const DEFAULT_TOOL_DISPLAY_CONFIG: ToolDisplayConfig = {
	enabled: true,
	debug: false,
	disableEnhancedToolRender: {
		/** Disable list: everything renders by default; `true` turns a tool's enhanced rendering off. */
		read: false,
		grep: false,
		find: false,
		ls: false,
		bash: false,
		edit: false,
		write: false,
	},
	customToolOverrides: {
		[CUSTOM_TOOL_OVERRIDE_WILDCARD]: { enabled: true, kind: "generic", outputMode: "summary" },
	},
	enableNativeUserMessageBox: false,
	enableShikiCodeBlocks: true,
	formatCodeBlocks: true,
	shikiCodeBlockTheme: "github-dark",
	readOutputMode: "hidden",
	searchOutputMode: "hidden",
	mcpOutputMode: "hidden",
	codemodeOutputMode: "calls",
	codemodeShowFileDiffs: true,
	previewLines: 8,
	expandedPreviewMaxLines: 4000,
	bashOutputMode: "opencode",
	bashCollapsedLines: 10,
	bashCommandMaxChars: 0,
	bashIntentMode: "off",
	bashIntentShowCommand: false,
	diffViewMode: "auto",
	diffIndicatorMode: "bars",
	diffSplitMinWidth: 120,
	diffCollapsedLines: 24,
	diffWordWrap: true,
	diffAddedBg: undefined,
	diffRemovedBg: undefined,
	diffAddedEmphasisBg: undefined,
	diffRemovedEmphasisBg: undefined,
	diffSyntaxHighlighting: "shiki",
	allowExternalDiffPreviews: false,
	showTruncationHints: false,
	showRtkCompactionHints: false,
};

export interface ConfigLoadResult {
	config: ToolDisplayConfig;
	error?: string;
}

export interface ConfigSaveResult {
	success: boolean;
	error?: string;
}
