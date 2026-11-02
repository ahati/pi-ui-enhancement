import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type {
	ZellijColorPalette,
	ZellijModalComponent,
	ZellijModalConfig,
	ZellijModalConfigPartial,
	ZellijModalContentRenderer,
	ZellijModalRenderOutput,
} from "./types.js";
import { BORDER_STYLES, DEFAULT_ZELLIJ_PALETTE } from "./types.js";
import { themeToZellijPalette } from "./theme.js";
import { normalizeHelpUndertitle, pushPaddingLines } from "./text-utils.js";
import { ZellijModalFrame } from "./frame.js";

export class ZellijModal implements ZellijModalComponent {
	config: ZellijModalConfig;
	content: ZellijModalContentRenderer;

	private frame: ZellijModalFrame;
	private palette: ZellijColorPalette;

	constructor(content: ZellijModalContentRenderer, config: ZellijModalConfigPartial = {}, theme?: Theme) {
		if (!content || typeof content.render !== "function") {
			throw new Error("ZellijModal requires a valid content renderer.");
		}

		this.config = this.buildConfig(config);
		this.palette = theme ? themeToZellijPalette(theme) : this.config.palette;
		this.content = content;
		this.frame = new ZellijModalFrame({ ...this.config, palette: this.palette });
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - 2 - this.config.padding * 2);
		const paddedWidth = contentWidth + this.config.padding * 2;
		const sidePadding = " ".repeat(this.config.padding);
		const lines: string[] = [];

		try {
			const rawLines = this.content.render(contentWidth);
			const normalized = rawLines.length > 0 ? rawLines : [""];

			pushPaddingLines(lines, this.config.padding, paddedWidth);

			for (const line of normalized) {
				const fitted = truncateToWidth(line, contentWidth, "", true);
				lines.push(`${sidePadding}${fitted}${sidePadding}`);
			}

			pushPaddingLines(lines, this.config.padding, paddedWidth);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const safe = truncateToWidth(` Render error: ${message} `, paddedWidth, "…", true);
			lines.push(safe);
		}

		return lines.length > 0 ? lines : [" ".repeat(paddedWidth)];
	}

	renderModal(width: number): ZellijModalRenderOutput {
		const frameWidth = this.resolveModalWidth(width);
		const contentLines = this.render(frameWidth);
		return this.frame.renderFrame(contentLines, frameWidth, this.palette);
	}

	invalidate(): void {
		this.content.invalidate();
	}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	getOverlayOptions(): { overlay: true; overlayOptions: ZellijModalConfig["overlay"] } {
		return {
			overlay: true,
			overlayOptions: this.config.overlay,
		};
	}

	dispose(): void {
		this.content.invalidate();
	}

	private buildConfig(partial: ZellijModalConfigPartial): ZellijModalConfig {
		const borderStyle = partial.borderStyle && BORDER_STYLES[partial.borderStyle] ? partial.borderStyle : "rounded";
		const padding = Math.max(0, partial.padding ?? 1);
		const minWidth = Math.max(4, partial.minWidth ?? 40);
		const maxWidth = Math.max(0, partial.maxWidth ?? 0);
		const helpUndertitle = normalizeHelpUndertitle(partial.helpText, partial.helpUndertitle);

		return {
			borderStyle,
			palette: partial.palette ?? DEFAULT_ZELLIJ_PALETTE,
			focused: partial.focused ?? true,
			padding,
			titleBar: partial.titleBar ?? { left: partial.title ?? "Modal" },
			helpUndertitle,
			minWidth,
			maxWidth,
			overlay: {
				anchor: partial.overlay?.anchor ?? "center",
				width: partial.overlay?.width ?? 70,
				maxHeight: partial.overlay?.maxHeight ?? "80%",
				margin: Math.max(0, partial.overlay?.margin ?? 1),
			},
		};
	}

	private resolveModalWidth(availableWidth: number): number {
		const width = Math.max(4, availableWidth);
		const boundedMax = this.config.maxWidth > 0 ? Math.min(width, this.config.maxWidth) : width;
		if (boundedMax >= this.config.minWidth) {
			return boundedMax;
		}
		return Math.max(4, boundedMax);
	}
}
