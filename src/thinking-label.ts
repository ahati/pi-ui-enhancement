import type {
  ExtensionAPI,
  ExtensionContext,
  MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import { isRecord } from "./tool-metadata.js";
import { onReloadShutdown } from "./extension-lifecycle.js";

interface ThemeLike {
  fg(color: string, text: string): string;
}

interface AssistantMessageLike {
  role?: unknown;
  api?: unknown;
  content?: unknown;
}

const THINKING_CHAT_PREFIX = "Thinking: ";
const THINKING_LABEL_PREFIX_PATTERN = /^(?:thinking:\s*)+/i;
const LEADING_ANSI_FRAGMENT_PATTERN = /^(?:\s*;?\d{1,3}(?:;\d{1,3})*m)+\s*/;
const MAX_THINKING_CONTENT_DEPTH = 16;

const registeredThinkingApis = new WeakSet<ExtensionAPI>();

// Theme snapshot for the render-time transformer. Pi hands the theme to event
// handlers but not to markdown transformers, so session_start refreshes this
// slot and the transformer reads it on every call.
let activeTheme: ThemeLike | undefined;

const OPENAI_REASONING_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

const ANTHROPIC_REASONING_APIS = new Set([
  "anthropic-messages",
  "anthropic-responses",
  "anthropic-completions",
]);

function normalizeApiName(api: unknown): string | undefined {
  if (typeof api !== "string") {
    return undefined;
  }

  const normalized = api.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function shouldPrefixThinkingForApi(api: unknown): boolean {
  const normalizedApi = normalizeApiName(api);
  if (!normalizedApi) {
    return true;
  }

  if (OPENAI_REASONING_APIS.has(normalizedApi)) {
    return true;
  }

  if (ANTHROPIC_REASONING_APIS.has(normalizedApi)) {
    return true;
  }

  if (normalizedApi.startsWith("anthropic-")) {
    return true;
  }

  // Keep OpenAI handling explicit to avoid applying this formatter to
  // unrelated OpenAI transport APIs that may not emit thinking blocks.
  if (normalizedApi.startsWith("openai-")) {
    return false;
  }

  // For non-OpenAI providers, apply the prefix when thinking blocks exist.
  return true;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function stripLeadingAnsiFragments(text: string): string {
  let current = text;
  while (true) {
    const next = current.replace(LEADING_ANSI_FRAGMENT_PATTERN, "");
    if (next === current) {
      return current;
    }
    current = next;
  }
}

function stripThinkingPresentationArtifacts(text: string): string {
  let current = stripAnsi(text);
  let removedThinkingLabel = false;

  while (true) {
    const withoutLabel = current
      .replace(THINKING_LABEL_PREFIX_PATTERN, "")
      .trimStart();
    if (withoutLabel !== current) {
      current = withoutLabel;
      removedThinkingLabel = true;
      continue;
    }

    const withoutAnsiFragments = stripLeadingAnsiFragments(current).trimStart();
    if (withoutAnsiFragments !== current) {
      const fragmentExposedAnotherLabel =
        withoutAnsiFragments.replace(THINKING_LABEL_PREFIX_PATTERN, "").trimStart() !==
        withoutAnsiFragments;

      if (removedThinkingLabel || fragmentExposedAnotherLabel) {
        current = withoutAnsiFragments;
        continue;
      }
    }

    return current;
  }
}

function formatThinkingLabel(theme: ThemeLike | undefined, thinkingText: string): string {
  if (!theme) {
    return `${THINKING_CHAT_PREFIX}${thinkingText}`;
  }

  const label = theme.fg("accent", THINKING_CHAT_PREFIX.trimEnd());
  const body = theme.fg("thinkingText", thinkingText);
  return `${label} ${body}`;
}

function prefixThinkingLine(text: string, theme: ThemeLike | undefined): string {
  const normalizedThinking = stripThinkingPresentationArtifacts(text).trim();
  if (!normalizedThinking) {
    return text;
  }

  return formatThinkingLabel(theme, normalizedThinking);
}

/**
 * Render-time transformer for hosts with registerMarkdownTransformer (Pi >= 1.x).
 * Pure: it receives the markdown Pi is about to render for a thinking block and
 * returns the labeled version without touching any stored message state, so
 * streaming, finalization, and session replay cannot produce label artifacts.
 * Strips label artifacts first, so thinking text persisted by the legacy event
 * pipeline (or a double pass) is labeled exactly once.
 */
const thinkingMarkdownTransformer: MarkdownTransformer = (markdown, context) => {
  if (context.messageType !== "assistant-thinking") {
    return markdown;
  }
  return prefixThinkingLine(markdown, activeTheme);
};

function normalizeThinkingLineForContext(text: string): string {
  return stripThinkingPresentationArtifacts(text);
}

function isThinkingBlock(value: unknown): value is Record<string, unknown> & {
  type: "thinking";
  thinking: string;
} {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "thinking" && typeof value.thinking === "string";
}

function mapThinkingContentArray(
  content: unknown[],
  mapThinkingText: (text: string) => string,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): { content: unknown[]; changed: boolean } {
  if (depth > MAX_THINKING_CONTENT_DEPTH || seen.has(content)) {
    return { content, changed: false };
  }

  seen.add(content);
  let changed = false;
  const nextContent = content.map((block) => {
    if (Array.isArray(block)) {
      const nested = mapThinkingContentArray(
        block,
        mapThinkingText,
        depth + 1,
        seen,
      );
      if (nested.changed) {
        changed = true;
        return nested.content;
      }
      return block as unknown[];
    }

    if (!isThinkingBlock(block)) {
      return block;
    }

    const nextThinking = mapThinkingText(block.thinking);
    if (nextThinking === block.thinking) {
      return block;
    }

    changed = true;
    return { ...block, thinking: nextThinking };
  });

  return { content: changed ? nextContent : content, changed };
}

function withThinkingLabelsForDisplay(
  content: unknown,
  theme: ThemeLike | undefined,
): unknown {
  if (!Array.isArray(content)) {
    return content;
  }

  const mapped = mapThinkingContentArray(content, (thinking) =>
    prefixThinkingLine(thinking, theme),
  );

  return mapped.changed ? mapped.content : content;
}

function sanitizeThinkingBlocksForContext(message: AssistantMessageLike): AssistantMessageLike {
  if (!Array.isArray(message.content)) {
    return message;
  }

  const mapped = mapThinkingContentArray(
    message.content,
    normalizeThinkingLineForContext,
  );

  return mapped.changed ? { ...message, content: mapped.content } : message;
}

function sanitizeContextMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }

  const messageList = messages as unknown[];
  let changed = false;
  const nextMessages = messageList.map((message) => {
    if (!isRecord(message) || message.role !== "assistant") {
      return message;
    }

    const sanitized = sanitizeThinkingBlocksForContext(message as AssistantMessageLike);
    if (sanitized !== message) {
      changed = true;
      return sanitized;
    }

    return message;
  });

  return changed ? nextMessages : messageList;
}

/**
 * Legacy fallback for hosts without registerMarkdownTransformer (0.8x): mutates
 * the transient message_update/message_end payload right before Pi renders it.
 * Render-only labeling - canonical session/LLM context content stays untouched;
 * the context handler below strips these labels again before each LLM call.
 */
function labelThinkingBlocksInEvent(
  event: unknown,
  ctx: ExtensionContext | undefined,
  notifyPrefix: string,
): void {
  try {
    const message = extractAssistantMessage(event);
    if (!message || !shouldPrefixThinkingForApi(message.api)) {
      return;
    }

    const displayContent = withThinkingLabelsForDisplay(message.content, ctx?.ui?.theme);
    if (displayContent !== message.content) {
      message.content = displayContent;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    ctx?.ui?.notify(`${notifyPrefix}: ${errorMessage}`, "warning");
  }
}

function extractAssistantMessage(event: unknown): AssistantMessageLike | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const maybeMessage = event.message;
  if (!isRecord(maybeMessage)) {
    return undefined;
  }

  if (maybeMessage.role !== "assistant") {
    return undefined;
  }

  return maybeMessage as AssistantMessageLike;
}

function handleThinkingContextEvent(event: unknown, ctx: ExtensionContext | undefined): void {
  try {
    if (!isRecord(event) || !Array.isArray(event.messages)) {
      return;
    }

    const sanitizedMessages = sanitizeContextMessages(event.messages);
    if (sanitizedMessages !== event.messages && Array.isArray(sanitizedMessages)) {
      event.messages.splice(0, event.messages.length, ...(sanitizedMessages as unknown[]));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ctx?.ui?.notify(`Thinking context sanitization failed: ${message}`, "warning");
  }
}

export function registerThinkingLabeling(pi: ExtensionAPI): void {
  if (registeredThinkingApis.has(pi)) {
    return;
  }
  registeredThinkingApis.add(pi);

  onReloadShutdown(pi, () => {
    registeredThinkingApis.delete(pi);
  });

  if (typeof pi.registerMarkdownTransformer === "function") {
    // Pi >= 1.x: label at render time. Stored messages are never touched, so
    // streaming, finalization, and session replay cannot produce artifacts.
    pi.registerMarkdownTransformer(thinkingMarkdownTransformer);
  } else {
    pi.on("message_update", async (event, ctx) => {
      labelThinkingBlocksInEvent(event, ctx, "Thinking label formatting failed");
    });

    pi.on("message_end", async (event, ctx) => {
      labelThinkingBlocksInEvent(event, ctx, "Thinking label finalization failed");
    });
  }

  pi.on("context", async (event, ctx) => {
    handleThinkingContextEvent(event, ctx);
  });

  pi.on("session_start", async (_event, ctx) => {
    // The markdown transformer reads this snapshot; event handlers get the
    // theme per call but transformers do not.
    activeTheme = ctx?.ui?.theme ?? undefined;

    // Re-applies on session_start; covers /reload where Pi resets labels
    // before re-emitting the event.
    const ui = ctx?.ui;
    if (typeof ui?.setHiddenThinkingLabel !== "function") {
      return; // Absent outside the interactive TUI; RPC ships a no-op anyway.
    }

    try {
      // theme.fg() resets only the foreground color, so the accent wrap
      // recolors Pi's italic thinkingText label without touching its styling.
      ui.setHiddenThinkingLabel(
        ui.theme ? ui.theme.fg("accent", "Thinking...") : "Thinking...",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx?.ui.notify(`Hidden thinking label formatting failed: ${message}`, "warning");
    }
  });
}
