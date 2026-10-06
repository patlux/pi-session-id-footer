import type { FooterComponent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

const WIDGET_KEY = "session-id-footer-hook";
const MIN_PADDING = 2;
const SHORT_SESSION_ID_LENGTH = 18;

type Theme = ExtensionContext["ui"]["theme"];

function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null
    && "render" in value && typeof value.render === "function"
    && "invalidate" in value && typeof value.invalidate === "function";
}

function isBuiltInFooter(component: Component): component is FooterComponent {
  // Bun/jiti can load separate class identities for host and extension modules.
  // Require the named Pi component AND its distinctive public API, not instanceof.
  return component.constructor.name === "FooterComponent"
    && "setSession" in component && typeof component.setSession === "function"
    && "setAutoCompactEnabled" in component && typeof component.setAutoCompactEnabled === "function";
}

function findBuiltInFooter(roots: readonly Component[]): FooterComponent | undefined {
  const pending = [...roots];
  const visited = new Set<Component>();
  const footers: FooterComponent[] = [];
  while (pending.length > 0) {
    const component = pending.pop();
    if (!component || visited.has(component)) continue;
    visited.add(component);
    if (isBuiltInFooter(component)) footers.push(component);
    else if ("children" in component) {
      const children: unknown = component.children;
      if (Array.isArray(children) && children.every(isComponent)) pending.push(...children);
    }
  }
  // Do not guess or replace another extension's custom footer.
  return footers.length === 1 ? footers[0] : undefined;
}

function sessionLabel(ctx: ExtensionContext): string {
  if (!ctx.sessionManager.getSessionFile()) return "sid unsaved";
  const id = ctx.sessionManager.getSessionId();
  return `sid ${process.env.PI_SESSION_ID_FOOTER_FORMAT === "full" ? id : id.slice(0, SHORT_SESSION_ID_LENGTH)}`;
}

function addRightLabel(line: string, label: string, theme: Theme, width: number): string {
  const right = theme.fg("dim", label);
  const rightWidth = visibleWidth(right);
  if (rightWidth + MIN_PADDING >= width) return truncateToWidth(right, width, theme.fg("dim", "..."));

  const left = truncateToWidth(line, width - rightWidth - MIN_PADDING, theme.fg("dim", "..."));
  return left + " ".repeat(width - visibleWidth(left) - rightWidth) + right;
}

function decorateFooter(footer: FooterComponent, ctx: ExtensionContext, theme: Theme): () => void {
  const originalRender = footer.render;
  let active = true;
  function render(this: FooterComponent, width: number): string[] {
    const lines = originalRender.call(this, width);
    if (!active || lines.length === 0) return lines;
    return [addRightLabel(lines[0], sessionLabel(ctx), theme, width), ...lines.slice(1)];
  }
  footer.render = render;
  return () => {
    if (!active) return;
    active = false;
    // Preserve a decorator installed by another extension after ours.
    if (footer.render === render) footer.render = originalRender;
  };
}

export default function sessionIdFooter(pi: ExtensionAPI): void {
  let dispose: (() => void) | undefined;
  let widgetInstalled = false;

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    dispose?.();
    // Pi exposes the live TUI through widget factories, but no footer-decorator API.
    // A zero-row below-editor widget gives us access without adding layout space.
    // Decorate only the mounted built-in instance, not a copy or the global prototype.
    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      const footer = findBuiltInFooter(tui.children);
      if (!footer) {
        ctx.ui.notify("Session ID: built-in footer not found; leaving the current footer unchanged.", "warning");
        dispose = undefined;
      } else {
        dispose = decorateFooter(footer, ctx, theme);
      }
      return { render: () => [], invalidate() {}, dispose };
    }, { placement: "belowEditor" });
    widgetInstalled = true;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    dispose?.();
    dispose = undefined;
    if (widgetInstalled && ctx.hasUI && ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
    widgetInstalled = false;
  });
}
