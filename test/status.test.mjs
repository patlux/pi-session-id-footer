import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { createHarness, messageEntry, usage } from "./harness.mjs";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const entry = new URL(`../${manifest.exports["."]}`, import.meta.url);
const { default: extension } = await import(entry);
const statusKey = "session-id";

function statusHarness(options = {}, entries = []) {
  const harness = createHarness(extension, entries, options);
  harness.ui.setStatus = (key, text) => {
    if (text === undefined) harness.statuses.delete(key);
    else harness.statuses.set(key, text);
  };
  return harness;
}

async function withFormat(format, run) {
  const previous = process.env.PI_SESSION_ID_FOOTER_FORMAT;
  if (format === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
  else process.env.PI_SESSION_ID_FOOTER_FORMAT = format;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
    else process.env.PI_SESSION_ID_FOOTER_FORMAT = previous;
  }
}

test("the package loads only the status-only entry point", () => {
  assert.deepEqual(manifest.pi.extensions, [manifest.exports["."]]);
});

test("leaves the built-in footer installed and never scans session history", async () => {
  const harness = statusHarness();
  const originalSetFooter = harness.ui.setFooter;
  await harness.emit("session_start", { reason: "startup" });

  assert.equal(harness.ui.setFooter, originalSetFooter);
  assert.equal(harness.metrics().setFooterCalls, 0);
  assert.equal(harness.metrics().getEntriesCalls, 0);
  assert.equal(harness.statuses.get(statusKey), "sid session-123");
});

test("keeps other extension statuses, including MCP", async () => {
  const harness = statusHarness({ statuses: [["mcp", "3 MCP servers"], ["goal", "working"]] });
  await harness.emit("session_start", { reason: "startup" });
  assert.equal(harness.statuses.get("mcp"), "3 MCP servers");
  assert.equal(harness.statuses.get("goal"), "working");
  assert.equal(harness.statuses.size, 3);
});

test("uses a short session id by default and for invalid formats", async () => {
  for (const format of [undefined, "invalid", "short"]) {
    await withFormat(format, async () => {
      const harness = statusHarness({ sessionId: "019fcc94-7f10-7545-a925-95943c353243" });
      await harness.emit("session_start", { reason: "startup" });
      assert.equal(harness.statuses.get(statusKey), "sid 019fcc94-7f10-7545");
    });
  }
});

test("supports full session ids", async () => {
  await withFormat("full", async () => {
    const harness = statusHarness({ sessionId: "019fcc94-7f10-7545-a925-95943c353243" });
    await harness.emit("session_start", { reason: "startup" });
    assert.equal(harness.statuses.get(statusKey), "sid 019fcc94-7f10-7545-a925-95943c353243");
  });
});

test("refreshes unsaved sessions after the first turn and switched sessions on start", async () => {
  const options = { saved: false, sessionId: "first-session" };
  const harness = statusHarness(options);
  await harness.emit("session_start", { reason: "startup" });
  assert.equal(harness.statuses.get(statusKey), "sid unsaved");

  options.saved = true;
  await harness.emit("turn_end");
  assert.equal(harness.statuses.get(statusKey), "sid first-session");

  options.sessionId = "next-session";
  await harness.emit("session_start", { reason: "switch" });
  assert.equal(harness.statuses.get(statusKey), "sid next-session");
});

test("cleans up only its own status and does not interfere with custom footers", async () => {
  const harness = statusHarness({ statuses: [["mcp", "ready"]] });
  const customFooter = () => ({ render: () => ["custom footer"], invalidate() {} });
  harness.ui.setFooter(customFooter);
  const originalSetFooter = harness.ui.setFooter;
  await harness.emit("session_start", { reason: "startup" });
  assert.equal(harness.ui.setFooter, originalSetFooter);
  assert.deepEqual(harness.component().render(80), ["custom footer"]);
  await harness.emit("session_shutdown");
  assert.deepEqual([...harness.statuses], [["mcp", "ready"]]);
  assert.equal(harness.metrics().setFooterCalls, 1);
});

test("does not touch UI in headless sessions", async () => {
  const harness = statusHarness();
  harness.ctx.hasUI = false;
  harness.ui.setStatus = () => assert.fail("headless sessions must not set status");
  await harness.emit("session_start", { reason: "startup" });
  await harness.emit("turn_end");
  await harness.emit("session_shutdown");
  assert.equal(harness.metrics().setFooterCalls, 0);
});

test("real Pi footer retains its exact stats, context, model and cache-hit rendering", async () => {
  // Optionally verify against the installed host package as well as the dev dependency.
  const piEntry = process.env.PI_FOOTER_TEST_ENTRY
    ? new URL(process.env.PI_FOOTER_TEST_ENTRY)
    : new URL(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { FooterComponent } = await import(new URL("./modes/interactive/components/footer.js", piEntry));
  const { initTheme } = await import(new URL("./modes/interactive/theme/theme.js", piEntry));
  initTheme("dark", false);

  const entries = [messageEntry("assistant", usage(100, 20, 900, 0, 0.125))];
  const harness = statusHarness({ statuses: [["mcp", "3 MCP servers"]] }, entries);
  const session = {
    state: { model: harness.ctx.model, thinkingLevel: "high" },
    model: harness.ctx.model,
    sessionManager: {
      ...harness.ctx.sessionManager,
      getEntryCount: () => entries.length,
      getLeafId: () => entries.at(-1)?.id,
    },
    modelRegistry: harness.ctx.modelRegistry,
    modelRuntime: { isUsingSubscription: () => false, isUsingOAuth: () => false },
    getContextUsage: harness.ctx.getContextUsage,
  };
  const footer = new FooterComponent(session, {
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () => harness.statuses,
  });
  const before = footer.render(160);
  await harness.emit("session_start", { reason: "startup" });
  const after = footer.render(160);

  assert.equal(harness.metrics().setFooterCalls, 0);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.equal(stripVTControlCharacters(after[2]), "3 MCP servers sid session-123");
  assert.match(stripVTControlCharacters(after[1]), /CH90\.0%/);

  // Rendering/truncation remains Pi's responsibility at every terminal width.
  const { visibleWidth } = await import(new URL("../../pi-tui/dist/index.js", piEntry));
  for (const width of [1, 10, 23, 40, 80, 160]) {
    for (const line of footer.render(width)) assert.ok(visibleWidth(line) <= width);
  }
});
