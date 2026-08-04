import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const [source, sessionFile, renderCountText = "500"] = process.argv.slice(2);
if (!source || !sessionFile) throw new Error("usage: real-session-benchmark.mjs SOURCE SESSION_FILE [RENDERS]");
const renderCount = Number(renderCountText);
const extension = (await import(pathToFileURL(source).href)).default;
const sessionManager = SessionManager.open(sessionFile);
let footerFactory;
let getEntriesCalls = 0;
const originalGetEntries = sessionManager.getEntries.bind(sessionManager);
sessionManager.getEntries = () => { getEntriesCalls++; return originalGetEntries(); };
const handlers = new Map();
const ui = { setFooter(factory) { footerFactory = factory; }, theme: { fg: (_color, text) => text } };
const ctx = {
  hasUI: true,
  ui,
  sessionManager,
  model: { id: "gpt-test", provider: "test", reasoning: true, contextWindow: 100000 },
  modelRegistry: { isUsingOAuth: () => false },
  getContextUsage: () => ({ tokens: 25000, contextWindow: 100000, percent: 25 }),
};
extension({ on(name, handler) { handlers.set(name, handler); }, getThinkingLevel: () => "high" });
await handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
const entries = originalGetEntries().length;
const component = footerFactory({ requestRender() {} }, ui.theme, {
  getGitBranch: () => "main",
  getExtensionStatuses: () => new Map([["a", "ready"]]),
  getAvailableProviderCount: () => 2,
  onBranchChange: () => () => {},
});
if (global.gc) global.gc();
const heapBefore = process.memoryUsage().heapUsed;
const started = performance.now();
for (let index = 0; index < renderCount; index++) component.render(index % 2 === 0 ? 120 : 121);
const elapsedMs = performance.now() - started;
if (global.gc) global.gc();
console.log(JSON.stringify({ source, sessionFile, entries, renderCount, elapsedMs, heapDelta: process.memoryUsage().heapUsed - heapBefore, getEntriesCalls }));
