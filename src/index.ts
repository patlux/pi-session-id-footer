import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MIN_PADDING = 2;
const SHORT_SESSION_ID_LENGTH = 18;
const STATUS_LABEL = "sid";
const HIDDEN_STATUS_KEYS = new Set(["mcp"]);

type SessionIdFormat = "short" | "full";

const EMPTY_TOTALS: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

type Theme = ExtensionContext["ui"]["theme"];
type FooterFactory = NonNullable<Parameters<ExtensionUIContext["setFooter"]>[0]>;
type FooterComponent = ReturnType<FooterFactory>;

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    total: number;
  };
}

interface FooterState {
  ctx: ExtensionContext;
  totals: UsageTotals;
  sessionName: string | undefined;
  revision: number;
}

interface InitialSessionState {
  totals: UsageTotals;
  sessionName: string | undefined;
}

interface InstalledFooter {
  addUsage(usage: MessageUsage | undefined): void;
  setSessionName(name: string | undefined): void;
  refresh(ctx: ExtensionContext): void;
  restore(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMessageUsage(value: unknown): value is MessageUsage {
  if (!isRecord(value) || !isRecord(value.cost)) return false;

  return (
    typeof value.input === "number" &&
    typeof value.output === "number" &&
    typeof value.cacheRead === "number" &&
    typeof value.cacheWrite === "number" &&
    typeof value.cost.total === "number"
  );
}

function usageForMessage(message: object): MessageUsage | undefined {
  if (!("usage" in message)) return undefined;
  return isMessageUsage(message.usage) ? message.usage : undefined;
}

function addUsage(totals: UsageTotals, usage: MessageUsage | undefined): void {
  if (!usage) return;
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

function readInitialSessionState(ctx: ExtensionContext): InitialSessionState {
  const totals = { ...EMPTY_TOTALS };
  let sessionName: string | undefined;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message") {
      addUsage(totals, usageForMessage(entry.message));
    } else if (entry.type === "session_info") {
      sessionName = entry.name?.trim() || undefined;
    }
  }

  return { totals, sessionName };
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sessionIdFormat(environmentValue: string | undefined): SessionIdFormat {
  return environmentValue === "full" ? "full" : "short";
}

function formatSessionStatus(ctx: ExtensionContext, format: SessionIdFormat): string {
  if (!ctx.sessionManager.getSessionFile()) return `${STATUS_LABEL} unsaved`;

  const sessionId = ctx.sessionManager.getSessionId();
  return `${STATUS_LABEL} ${format === "full" ? sessionId : sessionId.slice(0, SHORT_SESSION_ID_LENGTH)}`;
}

function formatPwd(state: FooterState, footerData: ReadonlyFooterDataProvider): string {
  let pwd = formatCwdForFooter(state.ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

  const branch = footerData.getGitBranch();
  if (branch) pwd = `${pwd} (${branch})`;
  if (state.sessionName) pwd = `${pwd} • ${state.sessionName}`;

  return pwd;
}

function addRightLabel(line: string, label: string, theme: Theme, width: number): string {
  const right = theme.fg("dim", label);
  const rightWidth = visibleWidth(right);

  if (rightWidth >= width) return truncateToWidth(right, width, theme.fg("dim", "..."));

  const leftWidth = Math.max(0, width - rightWidth - MIN_PADDING);
  const left = truncateToWidth(line, leftWidth, theme.fg("dim", "..."));
  const padding = " ".repeat(Math.max(MIN_PADDING, width - visibleWidth(left) - rightWidth));
  return left + padding + right;
}

function formatContextUsage(ctx: ExtensionContext, theme: Theme): string {
  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const contextPercentValue = contextUsage?.percent ?? 0;
  const contextPercent = contextUsage?.percent === null ? "?" : contextPercentValue.toFixed(1);
  const display =
    contextPercent === "?" ? `?/${formatTokens(contextWindow)} (auto)` : `${contextPercent}%/${formatTokens(contextWindow)} (auto)`;

  if (contextPercentValue > 90) return theme.fg("error", display);
  if (contextPercentValue > 70) return theme.fg("warning", display);
  return display;
}

function alignStatsLine(statsLeft: string, rightSide: string, theme: Theme, width: number): string {
  let left = statsLeft;
  let leftWidth = visibleWidth(left);

  if (leftWidth > width) {
    left = truncateToWidth(left, width, "...");
    leftWidth = visibleWidth(left);
  }

  const rightWidth = visibleWidth(rightSide);
  let statsLine: string;
  if (leftWidth + MIN_PADDING + rightWidth <= width) {
    statsLine = left + " ".repeat(width - leftWidth - rightWidth) + rightSide;
  } else {
    const availableForRight = width - leftWidth - MIN_PADDING;
    if (availableForRight > 0) {
      const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
      statsLine = left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncatedRight))) + truncatedRight;
    } else {
      statsLine = left;
    }
  }

  return theme.fg("dim", left) + theme.fg("dim", statsLine.slice(left.length));
}

function formatModelStatus(ctx: ExtensionContext, pi: ExtensionAPI, footerData: ReadonlyFooterDataProvider, statsLeft: string, width: number): string {
  const model = ctx.model;
  const modelName = model?.id || "no-model";

  let withoutProvider = modelName;
  if (model?.reasoning) {
    const thinkingLevel = pi.getThinkingLevel();
    withoutProvider = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
  }

  if (!model || footerData.getAvailableProviderCount() <= 1) return withoutProvider;

  const withProvider = `(${model.provider}) ${withoutProvider}`;
  return visibleWidth(statsLeft) + MIN_PADDING + visibleWidth(withProvider) <= width ? withProvider : withoutProvider;
}

function formatStatsLine(state: FooterState, pi: ExtensionAPI, footerData: ReadonlyFooterDataProvider, theme: Theme, width: number): string {
  const parts: string[] = [];
  const { ctx, totals } = state;

  if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
  if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
  if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
  if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);

  const model = ctx.model;
  const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  if (totals.cost || usingSubscription) parts.push(`$${totals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);

  parts.push(formatContextUsage(ctx, theme));
  const statsLeft = parts.join(" ");
  return alignStatsLine(statsLeft, formatModelStatus(ctx, pi, footerData, statsLeft, width), theme, width);
}

function formatStatusLine(footerData: ReadonlyFooterDataProvider, theme: Theme, width: number): string | undefined {
  const extensionStatuses = footerData.getExtensionStatuses();
  if (extensionStatuses.size === 0) return undefined;

  const statuses: Array<[string, string]> = [];
  for (const entry of extensionStatuses) {
    if (!HIDDEN_STATUS_KEYS.has(entry[0])) statuses.push(entry);
  }
  if (statuses.length === 0) return undefined;

  statuses.sort(([left], [right]) => left.localeCompare(right));
  const parts = statuses.map(([, text]) => sanitizeStatusText(text));
  return truncateToWidth(parts.join(" "), width, theme.fg("dim", "..."));
}

function createDefaultFooterFactory(state: FooterState, pi: ExtensionAPI, idFormat: SessionIdFormat): FooterFactory {
  return (tui, theme, footerData) => {
    let cachedWidth = -1;
    let cachedRevision = -1;
    let cachedMainLines: [string, string] | undefined;
    const dispose = footerData.onBranchChange(() => {
      state.revision++;
      tui.requestRender();
    });

    return {
      dispose,
      invalidate() {
        cachedRevision = -1;
      },
      render(width: number): string[] {
        if (!cachedMainLines || cachedWidth !== width || cachedRevision !== state.revision) {
          const ctx = state.ctx;
          cachedMainLines = [
            addRightLabel(theme.fg("dim", formatPwd(state, footerData)), formatSessionStatus(ctx, idFormat), theme, width),
            formatStatsLine(state, pi, footerData, theme, width),
          ];
          cachedWidth = width;
          cachedRevision = state.revision;
        }

        const statusLine = formatStatusLine(footerData, theme, width);
        return statusLine ? [cachedMainLines[0], cachedMainLines[1], statusLine] : cachedMainLines;
      },
    };
  };
}

function wrapFooterComponent(state: FooterState, component: FooterComponent, theme: Theme, idFormat: SessionIdFormat): FooterComponent {
  return {
    get wantsKeyRelease() {
      return component.wantsKeyRelease;
    },
    render(width: number): string[] {
      const label = formatSessionStatus(state.ctx, idFormat);
      const lines = component.render(width);
      if (lines.length === 0) return [truncateToWidth(theme.fg("dim", label), width, theme.fg("dim", "..."))];
      return [addRightLabel(lines[0] ?? "", label, theme, width), ...lines.slice(1)];
    },
    handleInput(data: string): void {
      component.handleInput?.(data);
    },
    invalidate(): void {
      component.invalidate();
    },
    dispose(): void {
      component.dispose?.();
    },
  };
}

function wrapFooterFactory(state: FooterState, factory: FooterFactory, idFormat: SessionIdFormat): FooterFactory {
  return (tui, theme, footerData) => wrapFooterComponent(state, factory(tui, theme, footerData), theme, idFormat);
}

function install(ctx: ExtensionContext, pi: ExtensionAPI): InstalledFooter | undefined {
  if (!ctx.hasUI) return undefined;

  const initialState = readInitialSessionState(ctx);
  const state: FooterState = { ctx, ...initialState, revision: 0 };
  const idFormat = sessionIdFormat(process.env.PI_SESSION_ID_FOOTER_FORMAT);
  const ui = ctx.ui;
  const originalSetFooter = ui.setFooter;
  function defaultFactory(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider): FooterComponent {
    return createDefaultFooterFactory(state, pi, idFormat)(tui, theme, footerData);
  }

  function setEnhancedDefaultFooter(): void {
    originalSetFooter(defaultFactory);
  }

  ui.setFooter = (factory) => {
    if (factory) {
      originalSetFooter(wrapFooterFactory(state, factory, idFormat));
    } else {
      setEnhancedDefaultFooter();
    }
  };

  setEnhancedDefaultFooter();

  return {
    addUsage(usage) {
      addUsage(state.totals, usage);
      state.revision++;
    },
    setSessionName(name) {
      state.sessionName = name;
      state.revision++;
    },
    refresh(nextCtx) {
      state.ctx = nextCtx;
      state.revision++;
    },
    restore() {
      ui.setFooter = originalSetFooter;
      originalSetFooter(undefined);
    },
  };
}

export default function sessionIdFooter(pi: ExtensionAPI) {
  let installed: InstalledFooter | undefined;

  pi.on("session_start", async (_event, ctx) => {
    installed?.restore();
    installed = install(ctx, pi);
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "user") installed?.addUsage(usageForMessage(event.message));
  });

  pi.on("model_select", async (_event, ctx) => installed?.refresh(ctx));
  pi.on("thinking_level_select", async (_event, ctx) => installed?.refresh(ctx));
  pi.on("session_info_changed", async (event, ctx) => {
    installed?.setSessionName(event.name);
    installed?.refresh(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => installed?.refresh(ctx));
  pi.on("session_tree", async (_event, ctx) => installed?.refresh(ctx));
  pi.on("session_compact", async (_event, ctx) => installed?.refresh(ctx));

  pi.on("session_shutdown", async () => {
    installed?.restore();
    installed = undefined;
  });
}
