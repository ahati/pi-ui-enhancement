import type { SettingItem } from "@earendil-works/pi-tui";

/**
 * Border character set used to render a modal frame.
 */
export interface BorderCharacters {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
	verticalLeft?: string;
	verticalRight?: string;
}

/**
 * Predefined border character sets aligned with Zellij styles.
 */
export const BORDER_STYLES = {
	rounded: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
		verticalLeft: "├",
		verticalRight: "┤",
	},
	square: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
		verticalLeft: "├",
		verticalRight: "┤",
	},
	double: {
		topLeft: "╔",
		topRight: "╗",
		bottomLeft: "╚",
		bottomRight: "╝",
		horizontal: "═",
		vertical: "║",
	},
	none: {
		topLeft: " ",
		topRight: " ",
		bottomLeft: " ",
		bottomRight: " ",
		horizontal: " ",
		vertical: " ",
	},
} as const satisfies Record<string, BorderCharacters>;

export type BorderStyle = keyof typeof BORDER_STYLES;

export type PaletteColor =
	| { type: "rgb"; r: number; g: number; b: number }
	| { type: "8bit"; code: number }
	| { type: "named"; name: string };

export interface ZellijColorPalette {
	fg: PaletteColor;
	bg: PaletteColor;
	accent: PaletteColor;
	muted: PaletteColor;
	dim: PaletteColor;
	success: PaletteColor;
	error: PaletteColor;
	warning: PaletteColor;
	border: PaletteColor;
	borderFocused: PaletteColor;
	borderUnfocused: PaletteColor;
}

export const DEFAULT_ZELLIJ_PALETTE: ZellijColorPalette = {
	fg: { type: "named", name: "white" },
	bg: { type: "named", name: "black" },
	accent: { type: "8bit", code: 36 },
	muted: { type: "8bit", code: 245 },
	dim: { type: "8bit", code: 238 },
	success: { type: "8bit", code: 154 },
	error: { type: "8bit", code: 124 },
	warning: { type: "8bit", code: 166 },
	border: { type: "8bit", code: 238 },
	borderFocused: { type: "8bit", code: 154 },
	borderUnfocused: { type: "8bit", code: 238 },
};

export interface TitleSegment {
	text: string;
	color: keyof ZellijColorPalette | PaletteColor;
	bgColor?: PaletteColor;
	bold?: boolean;
	truncate?: "start" | "middle" | "end" | "none";
	maxWidth?: number;
}

export interface TitleBarConfig {
	left?: TitleSegment | string;
	center?: TitleSegment | string;
	right?: TitleSegment | string;
	separator?: string;
}

export interface HelpUndertitleConfig {
	text?: string;
	textGenerator?: (width: number) => string;
	variants?: string[];
	keyHints?: Array<{
		key: string;
		description: string;
	}>;
	keyHintSeparator?: string;
	color?: keyof ZellijColorPalette;
}

export interface ZellijModalConfig {
	borderStyle: BorderStyle;
	palette: ZellijColorPalette;
	focused: boolean;
	padding: number;
	titleBar: TitleBarConfig;
	helpUndertitle?: HelpUndertitleConfig;
	minWidth: number;
	maxWidth: number;
	overlay: {
		anchor: "center" | "top" | "bottom";
		width: number | string;
		maxHeight: number | string;
		margin: number;
	};
}

export type ZellijModalConfigPartial = Partial<ZellijModalConfig> & {
	title?: string;
	helpText?: string | HelpUndertitleConfig;
};

export interface ZellijModalRenderOutput {
	lines: string[];
	visibleWidth: number;
	contentWidth: number;
	contentStartLine: number;
	contentEndLine: number;
}

export interface ZellijModalContentRenderer {
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
}

export interface ZellijModalComponent extends ZellijModalContentRenderer {
	config: ZellijModalConfig;
	content: ZellijModalContentRenderer;
	renderModal(width: number): ZellijModalRenderOutput;
	dispose(): void;
}

export interface ZellijModalTheme {
	palette: ZellijColorPalette;
	resolveColor: (color: PaletteColor | keyof ZellijColorPalette) => { fg: string; bg: string };
	colorizeForeground: (color: PaletteColor | keyof ZellijColorPalette, text: string) => string;
	colorizeBackground: (color: PaletteColor | keyof ZellijColorPalette, text: string) => string;
}

export interface SettingsModalOptions {
	title: string;
	description?: string;
	settings: SettingItem[];
	onChange: (id: string, value: string) => void;
	onClose: () => void;
	helpText?: string;
	enableSearch?: boolean;
}
