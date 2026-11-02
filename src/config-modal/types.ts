import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayCapabilities } from "../capabilities.js";
import type { ToolDisplayConfigScope } from "../config-store.js";
import type { ToolDisplayConfig } from "../types.js";

export interface DiffColorPreset {
	id: string;
	colors: Pick<
		ToolDisplayConfig,
		"diffAddedBg" | "diffRemovedBg" | "diffAddedEmphasisBg" | "diffRemovedEmphasisBg"
	>;
}

export interface ToolDisplayConfigController {
	getConfig(): ToolDisplayConfig;
	setConfig(next: ToolDisplayConfig, ctx: ExtensionCommandContext, options?: { scope?: ToolDisplayConfigScope }): boolean | void;
	getCapabilities(): ToolDisplayCapabilities;
	getConfigPath?(): string;
}

export interface ModalOverlayOptions {
	anchor: "center";
	width: number;
	maxHeight: number;
	margin: number;
}
