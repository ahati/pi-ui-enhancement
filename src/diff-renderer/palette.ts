import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	ANSI_SGR_PATTERN,
	expandSgrReset,
	filterSgrSequences,
	readSgrColorSequence,
	toSgrParams,
} from "../ansi-utils.js";
import {
	clampRenderedLineToWidth,
	clampRenderedLinesToWidth,
} from "../line-width-safety.js";
import type { ToolDisplayConfig } from "../types.js";
import type { DiffLineKind, DiffPalette, DiffTheme, RgbColor } from "./types.js";

export const ADD_ROW_BACKGROUND_MIX_RATIO = 0.12;
export const REMOVE_ROW_BACKGROUND_MIX_RATIO = 0.12;
export const ADD_INLINE_EMPHASIS_MIX_RATIO = 0.26;
export const REMOVE_INLINE_EMPHASIS_MIX_RATIO = 0.26;
export const ADDITION_TINT_TARGET: RgbColor = { r: 84, g: 190, b: 118 };
export const DELETION_TINT_TARGET: RgbColor = { r: 232, g: 95, b: 122 };
export const ANSI_BG_RESET = "\x1b[49m";

export const DIFF_WIDTH_OPS = {
	measure: visibleWidth,
	truncate: (text: string, maxWidth: number): string => truncateToWidth(text, maxWidth, ""),
};

export function sequenceResetsBackground(params: number[]): boolean {
	let index = 0;
	while (index < params.length) {
		const param = params[index] ?? 0;
		if (param === 0 || param === 49) {
			return true;
		}

		const colorSequence = readSgrColorSequence(params, index);
		index += colorSequence ? colorSequence.length : 1;
	}

	return false;
}

export function stripBackgroundResetParams(params: number[]): number[] {
	const filtered: number[] = [];

	for (let i = 0; i < params.length; i++) {
		const param = params[i] ?? 0;

		if (param === 0) {
			filtered.push(...expandSgrReset(param)!);
			continue;
		}

		if (param === 49) {
			continue;
		}

		const colorSequence = readSgrColorSequence(params, i);
		if (colorSequence) {
			filtered.push(...colorSequence);
			i += colorSequence.length - 1;
			continue;
		}

		filtered.push(param);
	}

	return filtered;
}

export function stabilizeBackgroundResets(text: string): string {
	if (!text) {
		return text;
	}
	return filterSgrSequences(text, stripBackgroundResetParams);
}

export function clampDiffLineToWidth(text: string, width: number): string {
	return stabilizeBackgroundResets(clampRenderedLineToWidth(text, width, DIFF_WIDTH_OPS));
}

export function clampDiffLinesToWidth(lines: string[], width: number): string[] {
	return clampRenderedLinesToWidth(lines, width, DIFF_WIDTH_OPS).map((line) => stabilizeBackgroundResets(line));
}

export function fitToWidth(text: string, width: number): string {
	const trimmed = truncateToWidth(text, width, "");
	const gap = Math.max(0, width - visibleWidth(trimmed));
	return gap > 0 ? `${trimmed}${" ".repeat(gap)}` : trimmed;
}

export function keepBackgroundAcrossResets(text: string, rowBg: string): string {
	if (!text) {
		return text;
	}

	return text.replace(ANSI_SGR_PATTERN, (sequence, rawParams: string) => {
		const params = toSgrParams(rawParams);
		if (params.length === 0 || !sequenceResetsBackground(params)) {
			return sequence;
		}
		return `${sequence}${rowBg}`;
	});
}

export function applyBackgroundToVisualRow(
	text: string,
	width: number,
	rowBgAnsi: string,
	restoreBgAnsi: string,
): string {
	if (width <= 0) {
		return "";
	}

	const fitted = fitToWidth(text, width);
	const withStableBackground = keepBackgroundAcrossResets(fitted, rowBgAnsi);
	return stabilizeBackgroundResets(`${rowBgAnsi}${withStableBackground}${restoreBgAnsi}`);
}

export function applyLineBackgroundToWrappedRows(
	rows: string[],
	width: number,
	rowBgAnsi: string,
	restoreBgAnsi: string,
): string[] {
	if (rows.length === 0) {
		return [applyBackgroundToVisualRow("", width, rowBgAnsi, restoreBgAnsi)];
	}

	return rows.map((row) => applyBackgroundToVisualRow(row, width, rowBgAnsi, restoreBgAnsi));
}

export function wrapToWidth(text: string, width: number, wordWrap: boolean): string[] {
	if (width <= 0) {
		return [""];
	}

	if (!wordWrap) {
		return [fitToWidth(text, width)];
	}

	const wrapped = wrapTextWithAnsi(text, width);
	if (wrapped.length === 0) {
		return [fitToWidth("", width)];
	}

	return wrapped.map((line) => fitToWidth(line, width));
}

export function ansi256ToRgb(code: number): RgbColor {
	if (code < 0) {
		return { r: 0, g: 0, b: 0 };
	}
	if (code <= 15) {
		const base16: RgbColor[] = [
			{ r: 0, g: 0, b: 0 },
			{ r: 128, g: 0, b: 0 },
			{ r: 0, g: 128, b: 0 },
			{ r: 128, g: 128, b: 0 },
			{ r: 0, g: 0, b: 128 },
			{ r: 128, g: 0, b: 128 },
			{ r: 0, g: 128, b: 128 },
			{ r: 192, g: 192, b: 192 },
			{ r: 128, g: 128, b: 128 },
			{ r: 255, g: 0, b: 0 },
			{ r: 0, g: 255, b: 0 },
			{ r: 255, g: 255, b: 0 },
			{ r: 0, g: 0, b: 255 },
			{ r: 255, g: 0, b: 255 },
			{ r: 0, g: 255, b: 255 },
			{ r: 255, g: 255, b: 255 },
		];
		return base16[code] ?? { r: 255, g: 255, b: 255 };
	}
	if (code >= 232) {
		const value = Math.max(0, Math.min(255, 8 + (code - 232) * 10));
		return { r: value, g: value, b: value };
	}

	const cube = code - 16;
	const levels = [0, 95, 135, 175, 215, 255];
	const blue = cube % 6;
	const green = Math.floor(cube / 6) % 6;
	const red = Math.floor(cube / 36) % 6;
	return {
		r: levels[red] ?? 0,
		g: levels[green] ?? 0,
		b: levels[blue] ?? 0,
	};
}

export function parseAnsiColorCode(ansi: string | undefined): RgbColor | null {
	if (!ansi) {
		return null;
	}
	const rgbMatch = /\x1b\[(?:3|4)8;2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(ansi);
	if (rgbMatch) {
		const r = Number.parseInt(rgbMatch[1] ?? "0", 10);
		const g = Number.parseInt(rgbMatch[2] ?? "0", 10);
		const b = Number.parseInt(rgbMatch[3] ?? "0", 10);
		if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
			return {
				r: Math.max(0, Math.min(255, r)),
				g: Math.max(0, Math.min(255, g)),
				b: Math.max(0, Math.min(255, b)),
			};
		}
	}

	const bitMatch = /\x1b\[(?:3|4)8;5;(\d{1,3})m/.exec(ansi);
	if (bitMatch) {
		const code = Number.parseInt(bitMatch[1] ?? "0", 10);
		if (Number.isFinite(code)) {
			return ansi256ToRgb(code);
		}
	}

	return null;
}

export function rgbToBgAnsi(color: RgbColor): string {
	const r = Math.max(0, Math.min(255, Math.round(color.r)));
	const g = Math.max(0, Math.min(255, Math.round(color.g)));
	const b = Math.max(0, Math.min(255, Math.round(color.b)));
	return `\x1b[48;2;${r};${g};${b}m`;
}

export function mixRgb(base: RgbColor, tint: RgbColor, ratio: number): RgbColor {
	const clamped = Math.max(0, Math.min(1, ratio));
	return {
		r: base.r * (1 - clamped) + tint.r * clamped,
		g: base.g * (1 - clamped) + tint.g * clamped,
		b: base.b * (1 - clamped) + tint.b * clamped,
	};
}

export function extractThemeBackgroundAnsi(text: string): string | undefined {
	if (!text || !text.includes("\x1b[")) {
		return undefined;
	}

	ANSI_SGR_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ANSI_SGR_PATTERN.exec(text)) !== null) {
		const parsed = toSgrParams(match[1] ?? "");
		for (let index = 0; index < parsed.length; index += 1) {
			const param = parsed[index] ?? 0;
			if ((param >= 40 && param <= 47) || (param >= 100 && param <= 107)) {
				return `\x1b[${param}m`;
			}

			const colorSequence = readSgrColorSequence(parsed, index);
			if (colorSequence?.[0] === 48) {
				return `\x1b[${colorSequence.join(";")}m`;
			}
			if (colorSequence) {
				index += colorSequence.length - 1;
			}
		}
	}

	return undefined;
}

export function readThemeAnsi(theme: DiffTheme, kind: "fg" | "bg", slot: string): string | undefined {
	try {
		if (kind === "fg" && typeof theme.getFgAnsi === "function") {
			return theme.getFgAnsi(slot);
		}
		if (kind === "bg") {
			if (typeof theme.getBgAnsi === "function") {
				return theme.getBgAnsi(slot);
			}
			if (typeof theme.bg === "function") {
				return extractThemeBackgroundAnsi(theme.bg(slot, " "));
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function resolveContainerBackgroundAnsi(theme: DiffTheme): string | undefined {
	return readThemeAnsi(theme, "bg", "toolSuccessBg")
		?? readThemeAnsi(theme, "bg", "toolPendingBg")
		?? readThemeAnsi(theme, "bg", "toolErrorBg")
		?? readThemeAnsi(theme, "bg", "userMessageBg");
}

export function hexToBgAnsi(color: string | undefined): string | undefined {
	if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
		return undefined;
	}

	const r = Number.parseInt(color.slice(1, 3), 16);
	const g = Number.parseInt(color.slice(3, 5), 16);
	const b = Number.parseInt(color.slice(5, 7), 16);
	return rgbToBgAnsi({ r, g, b });
}

export function resolveDiffPalette(theme: DiffTheme, config?: ToolDisplayConfig): DiffPalette {
	const baseBg = parseAnsiColorCode(readThemeAnsi(theme, "bg", "toolSuccessBg"))
		?? parseAnsiColorCode(readThemeAnsi(theme, "bg", "toolPendingBg"))
		?? parseAnsiColorCode(readThemeAnsi(theme, "bg", "userMessageBg"))
		?? { r: 32, g: 35, b: 42 };
	const addFg = parseAnsiColorCode(readThemeAnsi(theme, "fg", "toolDiffAdded")) ?? { r: 88, g: 173, b: 88 };
	const removeFg = parseAnsiColorCode(readThemeAnsi(theme, "fg", "toolDiffRemoved")) ?? { r: 196, g: 98, b: 98 };
	const addTint = mixRgb(addFg, ADDITION_TINT_TARGET, 0.35);
	const removeTint = mixRgb(removeFg, DELETION_TINT_TARGET, 0.65);

	const addRowBg = mixRgb(baseBg, addTint, ADD_ROW_BACKGROUND_MIX_RATIO);
	const removeRowBg = mixRgb(baseBg, removeTint, REMOVE_ROW_BACKGROUND_MIX_RATIO);
	const addEmphasisBg = mixRgb(baseBg, addTint, ADD_INLINE_EMPHASIS_MIX_RATIO);
	const removeEmphasisBg = mixRgb(baseBg, removeTint, REMOVE_INLINE_EMPHASIS_MIX_RATIO);

	const explicitAddRowBg = hexToBgAnsi(config?.diffAddedBg);
	const explicitRemoveRowBg = hexToBgAnsi(config?.diffRemovedBg);

	return {
		addRowBgAnsi: explicitAddRowBg ?? rgbToBgAnsi(addRowBg),
		removeRowBgAnsi: explicitRemoveRowBg ?? rgbToBgAnsi(removeRowBg),
		addEmphasisBgAnsi: hexToBgAnsi(config?.diffAddedEmphasisBg) ?? rgbToBgAnsi(addEmphasisBg),
		removeEmphasisBgAnsi: hexToBgAnsi(config?.diffRemovedEmphasisBg) ?? rgbToBgAnsi(removeEmphasisBg),
	};
}

export function getLineBackground(kind: DiffLineKind, palette: DiffPalette, isEmphasis: boolean): string | undefined {
	if (kind === "add") {
		return isEmphasis ? palette.addEmphasisBgAnsi : palette.addRowBgAnsi;
	}
	if (kind === "remove") {
		return isEmphasis ? palette.removeEmphasisBgAnsi : palette.removeRowBgAnsi;
	}
	return undefined;
}

export function applyBackgroundToVisibleRange(
	ansiText: string,
	start: number,
	end: number,
	backgroundAnsi: string,
	restoreBackgroundAnsi: string,
): string {
	if (!ansiText || start >= end || end <= 0) {
		return ansiText;
	}

	const rangeStart = Math.max(0, start);
	const rangeEnd = Math.max(rangeStart, end);
	let output = "";
	let visibleIndex = 0;
	let index = 0;
	let inRange = false;

	while (index < ansiText.length) {
		if (ansiText[index] === "\x1b") {
			const sequenceEnd = ansiText.indexOf("m", index);
			if (sequenceEnd !== -1) {
				output += ansiText.slice(index, sequenceEnd + 1);
				index = sequenceEnd + 1;
				continue;
			}
		}

		if (visibleIndex === rangeStart && !inRange) {
			output += backgroundAnsi;
			inRange = true;
		}
		if (visibleIndex === rangeEnd && inRange) {
			output += restoreBackgroundAnsi;
			inRange = false;
		}

		output += ansiText[index] ?? "";
		visibleIndex++;
		index++;
	}

	if (inRange) {
		output += restoreBackgroundAnsi;
	}

	return output;
}
