import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { usage, messageEntry } from "./harness.mjs";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const entry = new URL(`../${manifest.exports["."]}`, import.meta.url);
const host = process.env.PI_FOOTER_TEST_ENTRY
  ? new URL(process.env.PI_FOOTER_TEST_ENTRY)
  : new URL(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { FooterComponent } = await import(new URL("./modes/interactive/components/footer.js", host));
const { initTheme, theme } = await import(new URL("./modes/interactive/theme/theme.js", host));
const { Container, visibleWidth } = await import(new URL("../../pi-tui/dist/index.js", host));
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", host));
initTheme("dark", false);

async function harness(options = {}) {
  let extension;
  if (process.env.PI_FOOTER_TEST_ENTRY) {
    // Integration: the installed host must supply the same class identities via its loader.
    const loaded = await loadExtensions([entry.pathname], new URL("..", entry).pathname);
    assert.deepEqual(loaded.errors, []);
    extension = loaded.extensions[0];
  } else {
    // Source-level unit tests use one module graph with the local dev dependency.
    const handlers = new Map();
    const { default: register } = await import(entry);
    register({ on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); } });
    extension = { handlers };
  }
  const statuses = new Map(options.statuses ?? []);
  const entries = [messageEntry("assistant", usage(107000, 11000, 713000))];
  const sessionId = options.sessionId ?? "01a1112a-fd47-702a-a925-95943c353243";
  let saved = options.saved !== false;
  let scans = 0;
  const model = { id: "codex/gpt-6-astra", provider: "homelab-llm", reasoning: true, contextWindow: 272000 };
  const sessionManager = {
    getEntries: () => { scans++; return entries; },
    getEntryCount: () => entries.length,
    getLeafId: () => entries.at(-1)?.id,
    getSessionFile: () => saved ? "/tmp/footer-test-session.jsonl" : undefined,
    getSessionId: () => sessionId,
    getCwd: () => "/example/project",
    getSessionName: () => "Rust-Infrastruktur mit bestehenden Projekten abgleichen",
  };
  const session = {
    state: { model, thinkingLevel: "high" }, model, sessionManager,
    modelRuntime: { isUsingSubscription: () => false, isUsingOAuth: () => false },
    getContextUsage: () => ({ tokens: 108800, contextWindow: 272000, percent: 40 }),
  };
  const footer = new FooterComponent(session, {
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () => statuses,
  });
  const footerContainer = new Container();
  footerContainer.addChild(footer);
  const widgetContainer = new Container();
  const tui = new Container();
  tui.addChild(widgetContainer);
  tui.addChild(footerContainer);
  tui.requestRender = () => {};
  let widget;
  let setFooterCalls = 0;
  let setStatusCalls = 0;
  const ctx = {
    hasUI: true, mode: "tui", sessionManager,
    ui: {
      theme,
      setFooter() { setFooterCalls++; },
      setStatus(key, text) {
        setStatusCalls++;
        if (text === undefined) statuses.delete(key);
        else statuses.set(key, text);
      },
      setWidget(_key, factory, placement) {
        widget?.dispose?.();
        widgetContainer.clear();
        widget = undefined;
        if (!factory) return;
        assert.equal(placement?.placement, "belowEditor", "the hook must not add above-editor spacing");
        widget = factory(tui, theme);
        widgetContainer.addChild(widget);
      },
      notify(message) { throw new Error(message); },
    },
  };
  async function emit(name, event = {}) {
    for (const handler of extension.handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  }
  return {
    ctx, footer, footerContainer, tui, widgetContainer, statuses, entries, session, emit,
    save: () => { saved = true; },
    disposeWidget: () => widget?.dispose?.(),
    metrics: () => ({ setFooterCalls, setStatusCalls, scans }),
  };
}

async function withFormat(format, run) {
  const previous = process.env.PI_SESSION_ID_FOOTER_FORMAT;
  if (format === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
  else process.env.PI_SESSION_ID_FOOTER_FORMAT = format;
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
    else process.env.PI_SESSION_ID_FOOTER_FORMAT = previous;
  }
}

test("restores the two-line layout with sid right-aligned and the exact real Pi statistics", async () => {
  const h = await harness();
  const before = h.footer.render(160);
  const originalSetFooter = h.ctx.ui.setFooter;
  await h.emit("session_start");
  const after = h.tui.render(160);
  assert.equal(after.length, 2, "session id must not introduce a status row");
  assert.match(plain(after[0]), /Rust-Infrastruktur mit bestehenden Projekten abgleichen +sid 01a1112a-fd47-702a$/);
  assert.equal(visibleWidth(after[0]), 160);
  assert.equal(after[1], before[1], "stats must be byte-for-byte Pi's output");
  assert.match(plain(after[1]), /↑107k ↓11k R713k CH87\.0% 40\.0%\/272k \(auto\)/);
  assert.match(plain(after[1]), /\(homelab-llm\) codex\/gpt-6-astra • high$/);
  assert.equal(h.ctx.ui.setFooter, originalSetFooter);
  assert.equal(h.metrics().setFooterCalls, 0);
  assert.equal(h.metrics().setStatusCalls, 0);
  await h.emit("session_shutdown");
  assert.deepEqual(h.footer.render(160), before);
});

test("adds no layout widget rows or history scans when attaching", async () => {
  const h = await harness();
  await h.emit("session_start");
  assert.deepEqual(h.widgetContainer.render(160), []);
  assert.equal(h.metrics().scans, 0);
  await h.emit("session_shutdown");
  assert.equal(h.widgetContainer.children.length, 0);
});

test("preserves every other status verbatim rather than filtering the native output", async () => {
  const h = await harness({ statuses: [["mcp", "MCP: 10 servers enabled"], ["goal", "working"]] });
  const before = h.footer.render(160);
  await h.emit("session_start");
  assert.deepEqual(h.tui.render(160).slice(1), before.slice(1));
  assert.equal(h.metrics().setStatusCalls, 0);
  await h.emit("session_shutdown");
});

test("handles short, full and invalid formats at wide and narrow widths", async () => {
  for (const format of [undefined, "short", "invalid", "full"]) {
    await withFormat(format, async () => {
      const h = await harness();
      await h.emit("session_start");
      const expected = format === "full"
        ? "sid 01a1112a-fd47-702a-a925-95943c353243"
        : "sid 01a1112a-fd47-702a";
      assert.ok(plain(h.footer.render(160)[0]).endsWith(expected));
      if (format !== "full") assert.equal(plain(h.footer.render(23)[0]), expected);
      for (const width of [1, 10, 23, 40, 80, 160]) {
        for (const line of h.tui.render(width)) assert.ok(visibleWidth(line) <= width);
      }
      await h.emit("session_shutdown");
    });
  }
});

test("reflects unsaved-to-saved sessions without a copied session snapshot", async () => {
  const h = await harness({ saved: false });
  await h.emit("session_start");
  assert.match(plain(h.footer.render(160)[0]), /sid unsaved$/);
  h.save();
  assert.match(plain(h.footer.render(160)[0]), /sid 01a1112a-fd47-702a$/);
  await h.emit("session_shutdown");
});

test("keeps native usage updates, auto-compaction and model state live", async () => {
  const h = await harness();
  await h.emit("session_start");
  h.footer.render(160);
  h.entries.push(messageEntry("assistant", usage(100, 10, 900)));
  h.footer.setAutoCompactEnabled(false);
  h.session.state.thinkingLevel = "low";
  const stats = plain(h.footer.render(160)[1]);
  assert.match(stats, /CH90\.0%/);
  assert.doesNotMatch(stats, /\(auto\)/);
  assert.match(stats, /• low$/);
  await h.emit("session_shutdown");
});

test("restores the original instance on disposal and does not patch another footer or its prototype", async () => {
  const h = await harness();
  const other = await harness();
  const original = h.footer.render;
  await h.emit("session_start");
  assert.equal(other.footer.render, original);
  assert.equal(FooterComponent.prototype.render, original);
  h.disposeWidget();
  assert.equal(h.footer.render, original);
  await h.emit("session_shutdown");
  assert.equal(h.footer.render, original);
});

test("reattaches exactly once after reload or session replacement", async () => {
  const h = await harness();
  for (let i = 0; i < 3; i++) {
    await h.emit("session_start");
    assert.equal(plain(h.footer.render(160)[0]).match(/sid /g)?.length, 1);
    await h.emit("session_shutdown");
    assert.doesNotMatch(plain(h.footer.render(160)[0]), /sid /);
  }
});

test("leaves later decorators intact on shutdown but deactivates its own label", async () => {
  const h = await harness();
  await h.emit("session_start");
  const decorated = h.footer.render;
  const next = function (width) { return [...decorated.call(this, width), "other extension"]; };
  h.footer.render = next;
  await h.emit("session_shutdown");
  assert.equal(h.footer.render, next);
  assert.doesNotMatch(plain(h.footer.render(160)[0]), /sid /);
  assert.equal(h.footer.render(160).at(-1), "other extension");
});

test("leaves custom footers alone and reports an unsupported component tree without replacing it", async () => {
  const h = await harness();
  h.footerContainer.clear();
  const custom = { render: () => ["custom footer"], invalidate() {} };
  h.footerContainer.addChild(custom);
  const notices = [];
  h.ctx.ui.notify = (message) => notices.push(message);
  await h.emit("session_start");
  assert.deepEqual(h.tui.render(160), ["custom footer"]);
  assert.equal(notices.length, 1);
  assert.equal(h.metrics().setFooterCalls, 0);
  assert.equal(h.metrics().setStatusCalls, 0);
  await h.emit("session_shutdown");
});

test("does not touch UI in print or RPC mode", async () => {
  for (const mode of ["print", "rpc"]) {
    const h = await harness();
    h.ctx.mode = mode;
    h.ctx.hasUI = mode === "rpc";
    h.ctx.ui.setWidget = () => assert.fail("must not touch non-TUI modes");
    await h.emit("session_start");
    await h.emit("session_shutdown");
    assert.equal(h.metrics().setStatusCalls, 0);
  }
});
