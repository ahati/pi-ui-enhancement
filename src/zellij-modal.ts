// Zellij-styled modal primitives (frame, borders, palette, title bar, settings).
//
// History: vendored on 2026-03-01 from MasuRii's local (never-published)
// ../zellij-modal package to keep the extension self-contained. A 2026-11-21
// survey (GitHub code search for ZellijModalConfigPartial/DEFAULT_ZELLIJ_PALETTE,
// npm, pi.dev) found no public upstream: all 26 known copies are snapshots of
// this same vendored file across MasuRii's pi-* extensions and fork
// collections, each locally customized (e.g. pi-rtk-optimizer's tabbed
// settings modal). Inter-repo differences are local divergence, not newer
// upstream primitives. This fork now owns the module:
//   - 6258b3c modularized it into src/zellij-modal/{types,theme,text-utils,frame,modal,settings-modal}.ts
//   - ace16c6 ported it to pi-tui 1.6.0's readonly string[] render contract
// Do not "re-sync" against other copies; treat this tree as canonical.
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
