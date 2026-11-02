import assert from "node:assert/strict";
import test from "node:test";
import { TuiTest } from "@microsoft/tui-test";

const PI_ARGS = [
	"--offline",
	"--no-session",
	"--no-extensions",
	"-e",
	"./src/index.ts",
];

test("E2E Pi TUI Sessions Suite with @microsoft/tui-test", async () => {
	const session = TuiTest.ephemeral();
	try {
		// 1. Launch interactive Pi with extension loaded
		await session.run("pi", PI_ARGS, { cols: 100, rows: 30 });
		await session.getByText("escape interrupt").expect({ timeout: 15000 });

		const startText = await session.text();
		assert.ok(startText.includes("[Extensions]"), "expected [Extensions] section in banner");
		assert.ok(startText.includes("src"), "expected extension 'src' loaded");

		// 2. Open Settings modal via /tool-display
		await session.submit("/tool-display");
		await session.getByText("Pi Tool Display Settings").expect({ timeout: 15000 });

		const modalText = await session.text();
		assert.ok(modalText.includes("Global switch"), "expected Global switch row");
		assert.ok(modalText.includes("Preset profile"), "expected Preset profile row");
		assert.ok(modalText.includes("Read tool output"), "expected Read tool output row");
		assert.ok(modalText.includes("Space/Enter toggle"), "expected footer help text");

		// 3. Navigate down and close modal using Escape key
		await session.press("ArrowDown");
		await session.press("Escape");
		await new Promise((resolve) => setTimeout(resolve, 500));
		const closedText = await session.text();
		assert.ok(!closedText.includes("Pi Tool Display Settings"), "expected modal to be dismissed");

		// 4. Test /tool-display show command
		await session.submit("/tool-display show");
		await session.getByText("tool-display: enabled=").expect({ timeout: 15000 });
		const showText = await session.text();
		assert.ok(showText.includes("render={"), "expected Pi 1.5.0 render={...} status");

		// 5. Change preset via command line /tool-display preset balanced
		await session.submit("/tool-display preset balanced");
		await session.getByText("Tool display preset set to balanced.").expect({ timeout: 15000 });

		// 6. Reopen modal to verify active preset reflects balanced
		await session.submit("/tool-display");
		await session.getByText("Pi Tool Display Settings").expect({ timeout: 15000 });
		const balancedModalText = await session.text();
		assert.ok(balancedModalText.includes("balanced"), "expected preset 'balanced' in modal inspector");
		await session.press("Escape");
		await new Promise((resolve) => setTimeout(resolve, 500));

		// 7. Reset preset via command line /tool-display reset
		await session.submit("/tool-display reset");
		await session.getByText("Tool display preset reset to opencode.").expect({ timeout: 15000 });

		// 8. Interactive bash execution and TUI output rendering
		await session.submit("! echo \"PI_E2E_BASH_VERIFIED\"");
		await session.getByText("PI_E2E_BASH_VERIFIED").expect({ timeout: 15000 });
		const bashText = await session.text();
		assert.ok(bashText.includes("PI_E2E_BASH_VERIFIED"), "expected bash output in terminal buffer");
	} finally {
		await session.closeQuiet();
	}
});
