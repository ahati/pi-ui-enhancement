import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PaletteColor, ZellijColorPalette, ZellijModalTheme } from "./types.js";
import { DEFAULT_ZELLIJ_PALETTE } from "./types.js";

export const ANSI_RESET = "\x1b[0m";

export function clampInt(value: number, min: number, max: number): number {
	if (Number.isNaN(value) || !Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

export function resolveColor(color: PaletteColor): { fg: string; bg: string } {
	if (color.type === "rgb") {
		const r = clampInt(color.r, 0, 255);
		const g = clampInt(color.g, 0, 255);
		const b = clampInt(color.b, 0, 255);
		return {
			fg: `\x1b[38;2;${r};${g};${b}m`,
			bg: `\x1b[48;2;${r};${g};${b}m`,
		};
	}

	if (color.type === "8bit") {
		const code = clampInt(color.code, 0, 255);
		return {
			fg: `\x1b[38;5;${code}m`,
			bg: `\x1b[48;5;${code}m`,
		};
	}

	const namedMap: Record<string, number> = {
		black: 16,
		white: 255,
		red: 196,
		green: 46,
		blue: 45,
		yellow: 226,
		cyan: 51,
		magenta: 201,
		gray: 245,
		grey: 245,
		orange: 166,
	};
	const code = namedMap[color.name.toLowerCase()] ?? 255;
	return {
		fg: `\x1b[38;5;${code}m`,
		bg: `\x1b[48;5;${code}m`,
	};
}

export function resolvePaletteColor(color: PaletteColor | keyof ZellijColorPalette, palette: ZellijColorPalette): PaletteColor {
	if (typeof color === "string") {
		return palette[color];
	}
	return color;
}

export function createZellijModalTheme(palette: ZellijColorPalette): ZellijModalTheme {
	return {
		palette,
		resolveColor: (color) => resolveColor(resolvePaletteColor(color, palette)),
		colorizeForeground: (color, text) => `${resolveColor(resolvePaletteColor(color, palette)).fg}${text}${ANSI_RESET}`,
		colorizeBackground: (color, text) => `${resolveColor(resolvePaletteColor(color, palette)).bg}${text}${ANSI_RESET}`,
	};
}

export function parseAnsiForegroundColor(ansi: string): PaletteColor | null {
	const rgbMatch = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(ansi);
	if (rgbMatch) {
		const [, r, g, b] = rgbMatch;
		return {
			type: "rgb",
			r: clampInt(Number.parseInt(r ?? "0", 10), 0, 255),
			g: clampInt(Number.parseInt(g ?? "0", 10), 0, 255),
			b: clampInt(Number.parseInt(b ?? "0", 10), 0, 255),
		};
	}

	const bit8Match = /\x1b\[38;5;(\d+)m/.exec(ansi);
	if (bit8Match) {
		const [, code] = bit8Match;
		return {
			type: "8bit",
			code: clampInt(Number.parseInt(code ?? "255", 10), 0, 255),
		};
	}

	return null;
}

export function themeToZellijPalette(theme: Theme): ZellijColorPalette {
	const extract = (colorName: string, fallback: PaletteColor): PaletteColor => {
		const provider = theme as unknown as {
			getFgAnsi?: (name: string) => string;
		};
		if (!provider.getFgAnsi) {
			return fallback;
		}

		try {
			const ansi = provider.getFgAnsi(colorName);
			const parsed = parseAnsiForegroundColor(ansi);
			return parsed ?? fallback;
		} catch {
			return fallback;
		}
	};

	return {
		fg: extract("fg", DEFAULT_ZELLIJ_PALETTE.fg),
		bg: extract("bg", DEFAULT_ZELLIJ_PALETTE.bg),
		accent: extract("accent", DEFAULT_ZELLIJ_PALETTE.accent),
		muted: extract("muted", DEFAULT_ZELLIJ_PALETTE.muted),
		dim: extract("dim", DEFAULT_ZELLIJ_PALETTE.dim),
		success: extract("success", DEFAULT_ZELLIJ_PALETTE.success),
		error: extract("error", DEFAULT_ZELLIJ_PALETTE.error),
		warning: extract("warning", DEFAULT_ZELLIJ_PALETTE.warning),
		border: extract("borderMuted", DEFAULT_ZELLIJ_PALETTE.border),
		borderFocused: extract("accent", DEFAULT_ZELLIJ_PALETTE.borderFocused),
		borderUnfocused: extract("borderMuted", DEFAULT_ZELLIJ_PALETTE.borderUnfocused),
	};
}
