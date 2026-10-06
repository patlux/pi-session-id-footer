import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "session-id";
const SHORT_SESSION_ID_LENGTH = 18;

function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  const sessionManager = ctx.sessionManager;
  if (!sessionManager.getSessionFile()) {
    ctx.ui.setStatus(STATUS_KEY, "sid unsaved");
    return;
  }

  const sessionId = sessionManager.getSessionId();
  const label = process.env.PI_SESSION_ID_FOOTER_FORMAT === "full"
    ? sessionId
    : sessionId.slice(0, SHORT_SESSION_ID_LENGTH);
  ctx.ui.setStatus(STATUS_KEY, `sid ${label}`);
}

export default function sessionIdStatus(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => updateStatus(ctx));
  // A new session file is created lazily; refresh after its first completed turn.
  pi.on("turn_end", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
