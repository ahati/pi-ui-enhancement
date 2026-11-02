import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Box,
	Container,
	SettingsList,
	Spacer,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { SettingsModalOptions, ZellijModalContentRenderer } from "./types.js";
import { isEnterActivationInput } from "./text-utils.js";

export class ZellijSettingsModal implements ZellijModalContentRenderer {
	private container: Container;
	private contentBox: Box;
	private settingsList: SettingsList;
	private options: SettingsModalOptions;
	private theme: Theme;

	constructor(options: SettingsModalOptions, theme: Theme) {
		if (!options.title || !options.title.trim()) {
			throw new Error("ZellijSettingsModal requires a non-empty title.");
		}

		this.options = options;
		this.theme = theme;
		this.container = new Container();
		this.contentBox = new Box(0, 0);

		this.contentBox.addChild(new Text(this.theme.fg("accent", this.theme.bold(options.title)), 0, 0));

		if (options.description) {
			this.contentBox.addChild(new Spacer(1));
			this.contentBox.addChild(new Text(this.theme.fg("muted", options.description), 0, 0));
		}

		this.contentBox.addChild(new Spacer(1));
		this.settingsList = new SettingsList(
			options.settings,
			Math.min(Math.max(options.settings.length + 2, 6), 18),
			getSettingsListTheme(),
			(id, value) => {
				this.options.onChange(id, value);
			},
			() => {
				this.options.onClose();
			},
			{ enableSearch: options.enableSearch ?? true },
		);
		this.contentBox.addChild(this.settingsList);

		if (options.helpText) {
			this.contentBox.addChild(new Spacer(1));
			this.contentBox.addChild(new Text(this.theme.fg("dim", options.helpText), 0, 0));
		}

		this.container.addChild(this.contentBox);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		try {
			return this.container.render(safeWidth);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return [this.theme.fg("error", truncateToWidth(`Settings render error: ${message}`, safeWidth, "…"))];
		}
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		if (isEnterActivationInput(data)) {
			return;
		}
		this.settingsList.handleInput(data);
	}

	updateValue(id: string, value: string): void {
		this.settingsList.updateValue(id, value);
	}
}
