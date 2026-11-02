import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { HelpUndertitleConfig, ZellijModalConfigPartial } from "./types.js";

export function pushPaddingLines(lines: string[], count: number, paddedWidth: number): void {
	for (let i = 0; i < count; i++) {
		lines.push(" ".repeat(paddedWidth));
	}
}

export function isEnterActivationInput(data: string): boolean {
	return data === "\r" || data === "\n" || data === "\r\n";
}

export function normalizeHelpUndertitle(
	helpText: ZellijModalConfigPartial["helpText"],
	helpUndertitle: HelpUndertitleConfig | undefined,
): HelpUndertitleConfig | undefined {
	if (helpUndertitle) {
		return helpUndertitle;
	}
	if (typeof helpText === "string") {
		return helpText ? { text: helpText } : undefined;
	}
	return helpText;
}

export function earlyTruncate(text: string, maxWidth: number): string | undefined {
	if (visibleWidth(text) <= maxWidth) {
		return text;
	}
	if (maxWidth <= 1) {
		return "…".slice(0, maxWidth);
	}
	return undefined;
}

export function withEarlyTruncation(
	text: string,
	maxWidth: number,
	compute: () => string,
): string {
	const early = earlyTruncate(text, maxWidth);
	if (early !== undefined) {
		return early;
	}
	return compute();
}

export function truncateStart(text: string, maxWidth: number): string {
	return withEarlyTruncation(text, maxWidth, () => {
		const chars = Array.from(text);
		let current = "";
		for (let index = chars.length - 1; index >= 0; index--) {
			const candidate = `${chars[index]}${current}`;
			if (visibleWidth(candidate) >= maxWidth - 1) {
				current = candidate;
				break;
			}
			current = candidate;
		}
		return `…${truncateToWidth(current, Math.max(0, maxWidth - 1), "")}`;
	});
}

export function truncateMiddle(text: string, maxWidth: number): string {
	return withEarlyTruncation(text, maxWidth, () => {
		const headTarget = Math.floor((maxWidth - 1) / 2);
		const tailTarget = Math.max(0, maxWidth - 1 - headTarget);
		const head = truncateToWidth(text, headTarget, "");

		const chars = Array.from(text);
		let tail = "";
		for (let index = chars.length - 1; index >= 0; index--) {
			const candidate = `${chars[index]}${tail}`;
			if (visibleWidth(candidate) > tailTarget) {
				continue;
			}
			tail = candidate;
			if (visibleWidth(tail) === tailTarget) {
				break;
			}
		}

		return `${head}…${tail}`;
	});
}
