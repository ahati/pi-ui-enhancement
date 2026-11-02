import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
	BorderCharacters,
	PaletteColor,
	TitleSegment,
	ZellijColorPalette,
	ZellijModalConfig,
	ZellijModalRenderOutput,
	ZellijModalTheme,
} from "./types.js";
import { BORDER_STYLES } from "./types.js";
import { ANSI_RESET, clampInt, createZellijModalTheme } from "./theme.js";
import { truncateMiddle, truncateStart } from "./text-utils.js";

export interface PositionedTitleSegment {
	start: number;
	end: number;
	text: string;
	color: keyof ZellijColorPalette | PaletteColor;
	bold: boolean;
}

export class ZellijModalFrame {
	private config: ZellijModalConfig;
	private borders: BorderCharacters;
	private theme: ZellijModalTheme;

	constructor(config: ZellijModalConfig, modalTheme?: ZellijModalTheme) {
		this.config = config;
		this.borders = BORDER_STYLES[config.borderStyle] ?? BORDER_STYLES.rounded;
		this.theme = modalTheme ?? createZellijModalTheme(config.palette);
	}

	setConfig(config: ZellijModalConfig): void {
		this.config = config;
		this.borders = BORDER_STYLES[config.borderStyle] ?? BORDER_STYLES.rounded;
		this.theme = createZellijModalTheme(config.palette);
	}

	renderContentLine(content: string, width: number, palette: ZellijColorPalette): string {
		const frameWidth = Math.max(2, width);
		const innerWidth = Math.max(0, frameWidth - 2);
		const borderColor = this.config.focused ? palette.borderFocused : palette.borderUnfocused;
		const vertical = this.theme.colorizeForeground(borderColor, this.borders.vertical);
		const paddedContent = truncateToWidth(content, innerWidth, "", true);
		return `${vertical}${paddedContent}${vertical}`;
	}

	renderFrame(contentLines: string[], width: number, palette: ZellijColorPalette): ZellijModalRenderOutput {
		const frameWidth = Math.max(4, width);
		const safeContent = contentLines.length > 0 ? contentLines : [""];
		const lines: string[] = [];

		lines.push(this.renderTitleBar(frameWidth, palette));

		const contentStartLine = lines.length;
		for (const line of safeContent) {
			lines.push(this.renderContentLine(line, frameWidth, palette));
		}
		const contentEndLine = lines.length - 1;

		lines.push(this.renderBottomLine(frameWidth, palette));

		return {
			lines,
			visibleWidth: frameWidth,
			contentWidth: Math.max(1, frameWidth - 2 - this.config.padding * 2),
			contentStartLine,
			contentEndLine,
		};
	}

	private getBorderPaint(width: number, palette: ZellijColorPalette): {
		innerWidth: number;
		borderPaint: (text: string) => string;
	} {
		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.config.focused ? palette.borderFocused : palette.borderUnfocused;
		const borderPaint = (text: string) => this.theme.colorizeForeground(borderColor, text);
		return { innerWidth, borderPaint };
	}

	private renderBorderedRow(
		width: number,
		palette: ZellijColorPalette,
		corners: { left: string; right: string },
		renderInner: (innerWidth: number, borderPaint: (text: string) => string) => string,
	): string {
		const { innerWidth, borderPaint } = this.getBorderPaint(width, palette);
		if (innerWidth === 0) {
			return `${borderPaint(corners.left)}${borderPaint(corners.right)}`;
		}
		return `${borderPaint(corners.left)}${renderInner(innerWidth, borderPaint)}${borderPaint(corners.right)}`;
	}

	private renderTitleBar(width: number, palette: ZellijColorPalette): string {
		return this.renderBorderedRow(width, palette, { left: this.borders.topLeft, right: this.borders.topRight }, (innerWidth, borderPaint) => {
			const segments = this.positionTitleSegments(innerWidth);
			let inner = "";
			let cursor = 0;

			for (const segment of segments) {
				if (segment.start > cursor) {
					inner += borderPaint(this.borders.horizontal.repeat(segment.start - cursor));
				}
				const text = segment.bold ? `\x1b[1m${segment.text}${ANSI_RESET}` : segment.text;
				inner += this.theme.colorizeForeground(segment.color, text);
				cursor = segment.end;
			}

			if (cursor < innerWidth) {
				inner += borderPaint(this.borders.horizontal.repeat(innerWidth - cursor));
			}

			return inner;
		});
	}

	private renderBottomLine(width: number, palette: ZellijColorPalette): string {
		return this.renderBorderedRow(width, palette, { left: this.borders.bottomLeft, right: this.borders.bottomRight }, (innerWidth, borderPaint) => {
			const helpText = this.resolveHelpText(Math.max(0, innerWidth - 3));
			if (!helpText) {
				return borderPaint(this.borders.horizontal.repeat(innerWidth));
			}

			const helpSlot = this.config.helpUndertitle?.color ?? "dim";
			const safeHelp = truncateToWidth(helpText, Math.max(0, innerWidth - 3), "…");
			const helpWidth = visibleWidth(safeHelp);
			const rightFill = Math.max(0, innerWidth - helpWidth - 3);

			return `${borderPaint(this.borders.horizontal)} ${this.theme.colorizeForeground(helpSlot, safeHelp)} ${borderPaint(this.borders.horizontal.repeat(rightFill))}`;
		});
	}

	private positionTitleSegments(innerWidth: number): PositionedTitleSegment[] {
		if (innerWidth <= 0) {
			return [];
		}

		const left = this.resolveTitleSegment(this.config.titleBar.left, "left");
		const center = this.resolveTitleSegment(this.config.titleBar.center, "center");
		const right = this.resolveTitleSegment(this.config.titleBar.right, "right");

		const placements: PositionedTitleSegment[] = [];

		if (left) {
			const leftText = this.fitTextToWidth(left.text, Math.min(innerWidth, left.maxWidth ?? innerWidth), left.truncate);
			if (leftText) {
				placements.push({
					start: 0,
					end: Math.min(innerWidth, visibleWidth(leftText)),
					text: leftText,
					color: left.color,
					bold: left.bold ?? false,
				});
			}
		}

		if (right) {
			const reservedLeft = placements[0]?.end ?? 0;
			const available = Math.max(0, innerWidth - reservedLeft);
			const rightText = this.fitTextToWidth(right.text, Math.min(available, right.maxWidth ?? available), right.truncate);
			const rightWidth = visibleWidth(rightText);
			if (rightText && rightWidth > 0) {
				placements.push({
					start: innerWidth - rightWidth,
					end: innerWidth,
					text: rightText,
					color: right.color,
					bold: right.bold ?? false,
				});
			}
		}

		if (center) {
			const leftLimit = placements.find((placement) => placement.start === 0)?.end ?? 0;
			const rightStart = placements.find((placement) => placement.end === innerWidth)?.start ?? innerWidth;
			const freeWidth = Math.max(0, rightStart - leftLimit);
			if (freeWidth > 0) {
				const centerText = this.fitTextToWidth(center.text, Math.min(freeWidth, center.maxWidth ?? freeWidth), center.truncate);
				const centerWidth = visibleWidth(centerText);
				if (centerText && centerWidth > 0) {
					const centeredStart = Math.floor((innerWidth - centerWidth) / 2);
					const start = clampInt(centeredStart, leftLimit, Math.max(leftLimit, rightStart - centerWidth));
					placements.push({
						start,
						end: start + centerWidth,
						text: centerText,
						color: center.color,
						bold: center.bold ?? false,
					});
				}
			}
		}

		return placements.sort((a, b) => a.start - b.start);
	}

	private resolveTitleSegment(
		segment: TitleSegment | string | undefined,
		position: "left" | "center" | "right",
	): (TitleSegment & { text: string }) | null {
		if (!segment) {
			return null;
		}

		if (typeof segment === "string") {
			const color: keyof ZellijColorPalette = position === "left" ? "accent" : position === "center" ? "muted" : "dim";
			return {
				text: ` ${segment} `,
				color,
				bold: position === "left",
				truncate: "end",
				maxWidth: 0,
			};
		}

		const clean = segment.text.trim();
		if (!clean) {
			return null;
		}

		return {
			...segment,
			text: ` ${clean} `,
			truncate: segment.truncate ?? "end",
			bold: segment.bold ?? false,
		};
	}

	private fitTextToWidth(text: string, maxWidth: number, mode: TitleSegment["truncate"]): string {
		if (maxWidth <= 0) {
			return "";
		}
		if (visibleWidth(text) <= maxWidth) {
			return text;
		}

		switch (mode) {
			case "none":
				return truncateToWidth(text, maxWidth, "");
			case "start":
				return truncateStart(text, maxWidth);
			case "middle":
				return truncateMiddle(text, maxWidth);
			case "end":
			default:
				return truncateToWidth(text, maxWidth, "…");
		}
	}

	private resolveHelpText(maxWidth: number): string | null {
		const config = this.config.helpUndertitle;
		if (!config || maxWidth <= 0) {
			return null;
		}

		if (config.textGenerator) {
			try {
				const generated = config.textGenerator(maxWidth);
				if (generated && generated.trim()) {
					return generated;
				}
			} catch {
				return config.text?.trim() ? config.text : null;
			}
		}

		if (config.variants && config.variants.length > 0) {
			for (const variant of config.variants) {
				if (visibleWidth(variant) <= maxWidth) {
					return variant;
				}
			}
			return config.variants[config.variants.length - 1] ?? null;
		}

		if (config.keyHints && config.keyHints.length > 0) {
			const separator = config.keyHintSeparator ?? " • ";
			return config.keyHints
				.map((hint) => `${hint.key} ${hint.description}`)
				.join(separator);
		}

		return config.text?.trim() ? config.text : null;
	}
}
