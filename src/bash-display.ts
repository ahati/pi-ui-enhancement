import { Text } from "@earendil-works/pi-tui";
import { registerCleanup, registerTimer } from "./disposable.js";
import { extractProgramName } from "./bash-intent.js";
import { getModalIcons } from "./modal-icons.js";

const BASH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BASH_SPINNER_INTERVAL_MS = 200;
const BASH_SPINNER_STATE_KEY = "__piToolDisplayBashSpinner";
const BASH_SPINNER_TOOL_CALL_ID_KEY = "__piToolDisplayBashSpinnerToolCallId";

interface BashCallArgs {
	command?: string;
	commandPrefix?: string;
	description?: string;
	/** Explicit intent text — overrides a leading `# intent:` comment. */
	intent?: string;
	/** Explicit header label — overrides a leading `# tool:` comment. */
	tool?: string;
	/** Background-task marker: renders a `⏾ background` badge in the header. */
	background?: boolean;
	/** Optional task label shown next to the background badge. */
	taskName?: string;
	/** Working directory — shown as a `cwd:` line in the expanded view. */
	cwd?: string;
	/** Management mode: renders a `bash tasks <action>` header instead of a command. */
	taskAction?: string;
	/** Task id for management calls. */
	taskId?: string;
	shellPath?: string;
	timeout?: number;
}

/**
 * Optional per-call display options.
 *
 * `intentMode`/`showCommand` drive the intent header, taken from either an
 * explicit `description` argument (when a custom shell tool supplies one) or a
 * leading comment line:
 *
 *     # intent: check which files are dirty
 *     git status --short
 *
 * Only the first non-blank line is inspected, and only comment lines qualify, so
 * an intent can never be mistaken for executable content.
 *
 * `maxCommandChars` truncates the displayed command (0 = unlimited).
 */
export interface BashCallRenderOptions {
	intentMode?: "off" | "render" | "render-and-instruct";
	showCommand?: boolean;
	maxCommandChars?: number;
}

/**
 * Optional display params sometimes arrive as junk — models emit literal
 * "null"/"undefined" strings for absent optionals. Treat those as absent.
 */
function cleanOptionalText(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "null" || trimmed === "undefined") return "";
	return value;
}

const INTENT_COMMENT_PATTERN = /^\s*#\s*intent\s*:\s*(.+?)\s*$/i;
const TOOL_COMMENT_PATTERN = /^\s*#\s*tool\s*:\s*(.+?)\s*$/i;

interface BashCallRenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

interface BashSpinnerState {
	frameIndex: number;
	startedAt?: number;
	timer?: ReturnType<typeof setInterval>;
}

interface BashSpinnerStateCarrier {
	[BASH_SPINNER_STATE_KEY]?: BashSpinnerState;
	[BASH_SPINNER_TOOL_CALL_ID_KEY]?: string;
}

interface BashCallRenderContextLike {
	executionStarted: boolean;
	isPartial: boolean;
	expanded?: boolean;
	invalidate?: () => void;
	lastComponent?: unknown;
	state?: unknown;
	toolCallId?: string;
}

const spinnerStatesByToolCallId = new Map<string, BashSpinnerState>();
let nextSyntheticToolCallId = 0;

function toStateCarrier(value: unknown): BashSpinnerStateCarrier | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return value as BashSpinnerStateCarrier;
}

export { toStateCarrier };

function getSyntheticToolCallId(carrier: BashSpinnerStateCarrier | undefined): string | undefined {
	if (!carrier) {
		return undefined;
	}

	if (!carrier[BASH_SPINNER_TOOL_CALL_ID_KEY]) {
		carrier[BASH_SPINNER_TOOL_CALL_ID_KEY] = `state:${++nextSyntheticToolCallId}`;
	}
	return carrier[BASH_SPINNER_TOOL_CALL_ID_KEY];
}

function getToolCallId(context: BashCallRenderContextLike): string | undefined {
	if (typeof context.toolCallId === "string" && context.toolCallId.trim().length > 0) {
		return context.toolCallId;
	}
	return getSyntheticToolCallId(toStateCarrier(context.state));
}

function getOrCreateSpinnerState(
	toolCallId: string | undefined,
	carrier: BashSpinnerStateCarrier | undefined,
): BashSpinnerState | undefined {
	if (!toolCallId) {
		return undefined;
	}

	let state = spinnerStatesByToolCallId.get(toolCallId);
	if (!state) {
		state = { frameIndex: 0 };
		spinnerStatesByToolCallId.set(toolCallId, state);
	}
	if (carrier) {
		carrier[BASH_SPINNER_STATE_KEY] = state;
	}
	return state;
}

function stopSpinner(toolCallId: string | undefined, state: BashSpinnerState | undefined): void {
	if (!state) {
		return;
	}

	if (state.timer) {
		clearInterval(state.timer);
		state.timer = undefined;
	}
	state.frameIndex = 0;
	state.startedAt = undefined;
	if (toolCallId) {
		spinnerStatesByToolCallId.delete(toolCallId);
	}
}

function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) {
		return `${totalMinutes}m ${seconds}s`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function isDefaultShellPath(shellPath: string): boolean {
	const normalized = shellPath.trim().replace(/\\/g, "/").toLowerCase();
	const basename = normalized.split("/").pop() || normalized;
	return basename === "bash" || basename === "cmd.exe";
}

function truncateCommand(command: string, maxChars: number): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0) {
		return command;
	}
	// Collapse line breaks so a long multi-line command stays on one display line.
	const singleLine = command.replace(/\s*\r?\n\s*/g, " ; ");
	if (singleLine.length <= maxChars) {
		return singleLine;
	}
	const cutoff = Math.max(1, maxChars - 1);
	return `${singleLine.slice(0, cutoff)}…`;
}

/**
 * Reads the leading `# intent:` / `# tool:` comment block. `tool` is the label the
 * agent chose for the header (`git status`), which is kept out of the command
 * parser entirely — a shell command cannot distinguish a subcommand from an
 * argument, and guessing would need a curated list of programs.
 *
 * Never returns `undefined`: a command with no comment block simply yields an
 * empty result, so the caller decides what to do with it.
 */
function parseLeadingComments(
	command: string,
): { intent?: string; tool?: string; stripped: string } {
	const lines = command.split("\n");
	const intentLines: string[] = [];
	let tool: string | undefined;
	let consumed = 0;

	for (const line of lines) {
		if (line.trim().length === 0 && consumed === 0) {
			consumed += 1;
			continue;
		}

		const toolMatch = TOOL_COMMENT_PATTERN.exec(line);
		if (toolMatch) {
			tool ??= toolMatch[1];
			consumed += 1;
			continue;
		}

		const intentMatch = INTENT_COMMENT_PATTERN.exec(line);
		if (!intentMatch) {
			break;
		}

		intentLines.push(intentMatch[1]);
		consumed += 1;
	}

	return {
		intent: intentLines.length > 0 ? intentLines.join(" ") : undefined,
		tool,
		stripped: lines.slice(consumed).join("\n").trim(),
	};
}

function resolveIntentDisplay(
	args: BashCallArgs,
	options: BashCallRenderOptions | undefined,
): { intent: string; tool?: string; strippedCommand?: string } | undefined {
	// Explicit `intent`/`tool` arguments are structured tool data — they render
	// regardless of intentMode (which gates only leading-comment parsing).
	// Junk values ("null"/"undefined" strings) count as absent here too.
	const alwaysIntent = cleanOptionalText(args.intent);
	const alwaysTool = cleanOptionalText(args.tool);
	if (!options || options.intentMode === undefined || options.intentMode === "off") {
		if (alwaysIntent.length > 0 || alwaysTool.length > 0) {
			return { intent: alwaysIntent, tool: alwaysTool.length > 0 ? alwaysTool : undefined };
		}
		return undefined;
	}

	const command = typeof args.command === "string" ? args.command : "";
	const parsed = parseLeadingComments(command);

	// An explicit `intent`/`description` argument overrides the comment's intent
	// text; an explicit `tool` argument overrides the comment's label. The
	// stripped command still applies when it came from a comment.
	// An explicit `intent`/`description` argument overrides the comment's intent
	// text; an explicit `tool` argument overrides the comment's label. Junk
	// values ("null"/"undefined" strings) count as absent.
	const explicitIntent = cleanOptionalText(args.intent) || cleanOptionalText(args.description);
	const explicitTool = cleanOptionalText(args.tool);
	const intent = explicitIntent.length > 0 ? explicitIntent : parsed.intent;
	const tool = explicitTool.length > 0 ? explicitTool : parsed.tool;
	// Original rule for parsed comments: an intent is required (a bare `# tool:`
	// comment never produces a header). Explicit arguments may stand alone.
	if (intent === undefined && explicitTool === "") {
		return undefined;
	}

	return { intent: intent ?? "", tool, strippedCommand: parsed.stripped };
}

function buildCommandDisplay(args: BashCallArgs, maxCommandChars?: number): string {
	const command =
		typeof args.command === "string" && args.command.trim().length > 0
			? truncateCommand(args.command, maxCommandChars ?? 0)
			: "...";
	const prefix =
		typeof args.commandPrefix === "string" && args.commandPrefix.trim().length > 0
			? args.commandPrefix.trim()
			: "";
	return prefix ? `${prefix} ${command}` : command;
}

/** Icon detection is terminal-dependent and constant per process. */
let cachedToolIcon: string | undefined;
function toolIcon(): string {
	cachedToolIcon ??= getModalIcons().tool;
	return cachedToolIcon;
}

/**
 * The styled intent header: wrench, program (plus subcommand), then the intent,
 * with the arguments omitted.
 *
 *     🔧 git status · check which files are dirty
 *
 * When the tool call is expanded (Ctrl+O) the full command is appended on the
 * following line, because the header deliberately hides the arguments.
 */
function buildIntentHeader(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	options: BashCallRenderOptions | undefined,
	expanded?: boolean,
): string | undefined {
	const intent = resolveIntentDisplay(args, options);
	if (!intent) {
		return undefined;
	}

	const stripped = (intent.strippedCommand ?? "").trim();
	// Prefer the agent's own label; otherwise the program is all the command can
	// tell us without guessing.
	const label = intent.tool ?? extractProgramName(stripped || args.command || "");
	const separator = ` ${theme.fg("muted", "·")} `;
	const intentText = theme.fg("accent", intent.intent);

	// Without a label (e.g. a command made only of `cd` calls) the icon stays but the
	// separator goes, so the header never renders a dangling `🔧 ·`.
	const head = label.length > 0
		? `${toolIcon()} ${theme.fg("toolTitle", theme.bold(label))}${separator}${intentText}`
		: `${toolIcon()} ${intentText}`;

	// Expanded: the full command replaces the optional one-line suffix.
	if (expanded) {
		return stripped.length > 0 ? `${head}\n${theme.fg("muted", stripped)}` : head;
	}

	if (options?.showCommand && stripped.length > 0) {
		return `${head}${separator}${theme.fg("muted", stripped.replace(/\s+/g, " "))}`;
	}

	return head;
}

function buildBashCallText(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	options?: BashCallRenderOptions,
	expanded?: boolean,
	spinnerFrame?: string,
	elapsedMs?: number,
): string {
	// Management calls (taskAction) render a dedicated header — there is no
	// command to display. Only known actions qualify; junk values (models
	// sometimes emit "null") fall through to the ordinary command rendering.
	const KNOWN_TASK_ACTIONS = new Set(["list", "status", "kill", "input", "adopt"]);
	if (typeof args.taskAction === "string" && KNOWN_TASK_ACTIONS.has(args.taskAction.trim())) {
		const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
		const detail = theme.fg("accent", `${args.taskAction.trim()}${taskId ? ` ${taskId}` : ""}`);
		const spinnerPrefix = spinnerFrame ? `${theme.fg("warning", `${spinnerFrame} `)}` : "";
		const elapsedSuffix =
			spinnerFrame && elapsedMs !== undefined
				? theme.fg("muted", ` · ${formatElapsed(elapsedMs)}`)
				: "";
		return `${spinnerPrefix}${toolIcon()} ${theme.fg("toolTitle", theme.bold("bash tasks"))} ${theme.fg("muted", "·")} ${detail}${elapsedSuffix}`;
	}

	const commandDisplay = buildCommandDisplay(args, options?.maxCommandChars);
	const intentHeader = buildIntentHeader(args, theme, options, expanded);
	const shellSuffix =
		typeof args.shellPath === "string" &&
		args.shellPath.trim().length > 0 &&
		!isDefaultShellPath(args.shellPath)
			? theme.fg("muted", ` [shell: ${args.shellPath}]`)
			: "";
	const timeoutSuffix = args.timeout
		? theme.fg("muted", ` (timeout ${args.timeout}s)`)
		: "";
	const taskNameDisplay = cleanOptionalText(args.taskName);
	const backgroundSuffix = args.background
		? theme.fg("muted", ` ⏾ background${taskNameDisplay ? ` · ${taskNameDisplay}` : ""}`)
		: "";
	const spinnerPrefix = spinnerFrame ? `${theme.fg("warning", `${spinnerFrame} `)}` : "";
	const elapsedSuffix =
		spinnerFrame && elapsedMs !== undefined
			? theme.fg("muted", ` · ${formatElapsed(elapsedMs)}`)
			: "";

	const prompt = intentHeader ?? `${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", commandDisplay)}`;
	// Suffixes (shell/timeout/elapsed) belong on the header line, before the
	// expanded command body appended by buildIntentHeader.
	const [head, ...rest] = prompt.split("\n");
	const tail = rest.length > 0 ? `\n${rest.join("\n")}` : "";
	const cwdDisplay = cleanOptionalText(args.cwd);
	const cwdLine = expanded && cwdDisplay ? `\n${theme.fg("muted", `cwd: ${cwdDisplay.trim()}`)}` : "";
	return `${spinnerPrefix}${head}${shellSuffix}${timeoutSuffix}${backgroundSuffix}${elapsedSuffix}${tail}${cwdLine}`;
}

export function renderBashCall(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	context: BashCallRenderContextLike,
	options?: BashCallRenderOptions,
): Text {
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	const carrier = toStateCarrier(context.state);
	const toolCallId = getToolCallId(context);
	const spinnerState = getOrCreateSpinnerState(toolCallId, carrier);
	const shouldSpin = context.executionStarted && context.isPartial;

	if (!shouldSpin) {
		stopSpinner(toolCallId, spinnerState);
		text.setText(buildBashCallText(args, theme, options, context.expanded === true));
		return text;
	}

	if (spinnerState) {
		spinnerState.startedAt ??= Date.now();
		if (!spinnerState.timer && typeof context.invalidate === "function") {
			const timer = setInterval(() => {
				spinnerState.frameIndex = (spinnerState.frameIndex + 1) % BASH_SPINNER_FRAMES.length;
				text.setText(
					buildBashCallText(
						args,
						theme,
						options,
						context.expanded === true,
						BASH_SPINNER_FRAMES[spinnerState.frameIndex],
						Date.now() - (spinnerState.startedAt ?? Date.now()),
					),
				);
				context.invalidate?.();
			}, BASH_SPINNER_INTERVAL_MS);
			spinnerState.timer = timer;
			registerTimer(timer);
			registerCleanup(() => {
				if (spinnerStatesByToolCallId.get(toolCallId || "") === spinnerState) {
					stopSpinner(toolCallId, spinnerState);
				}
			});
		}
	}

	const spinnerFrame = spinnerState ? BASH_SPINNER_FRAMES[spinnerState.frameIndex] : undefined;
	const elapsedMs = spinnerState?.startedAt !== undefined
		? Date.now() - spinnerState.startedAt
		: undefined;
	text.setText(buildBashCallText(args, theme, options, context.expanded === true, spinnerFrame, elapsedMs));
	return text;
}
