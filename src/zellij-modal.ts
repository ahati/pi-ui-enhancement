// Vendored from ../zellij-modal/index.ts to keep pi-render standalone.
// Keep this module in sync when upstream zellij-modal primitives change.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type {
	BorderCharacters,
	BorderStyle,
	PaletteColor,
	ZellijColorPalette,
	TitleSegment,
	TitleBarConfig,
	HelpUndertitleConfig,
	ZellijModalConfig,
	ZellijModalConfigPartial,
	ZellijModalRenderOutput,
	ZellijModalContentRenderer,
	ZellijModalComponent,
	ZellijModalTheme,
	SettingsModalOptions,
} from "./zellij-modal/types.js";
export {
	BORDER_STYLES,
	DEFAULT_ZELLIJ_PALETTE,
} from "./zellij-modal/types.js";
export {
	ANSI_RESET,
	clampInt,
	resolveColor,
	resolvePaletteColor,
	createZellijModalTheme,
	parseAnsiForegroundColor,
	themeToZellijPalette,
} from "./zellij-modal/theme.js";
export {
	pushPaddingLines,
	isEnterActivationInput,
	normalizeHelpUndertitle,
	earlyTruncate,
	withEarlyTruncation,
	truncateStart,
	truncateMiddle,
} from "./zellij-modal/text-utils.js";
export {
	type PositionedTitleSegment,
	ZellijModalFrame,
} from "./zellij-modal/frame.js";
export {
	ZellijModal,
} from "./zellij-modal/modal.js";
export {
	ZellijSettingsModal,
} from "./zellij-modal/settings-modal.js";

/**
 * Extension factory entrypoint for Pi extension loader.
 *
 * This extension intentionally registers no commands/events and only exposes
 * reusable modal primitives for sibling extensions.
 */
export default function zellijModalExtension(_pi: ExtensionAPI): void {
	// no-op
}
