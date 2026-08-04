import assert from "node:assert/strict";
import test from "node:test";
import extension from "../src/index.ts";
import { createHarness, messageEntry, usage } from "./harness.mjs";

test("renders preserved default footer behavior with a short session id", async () => {
  const harness = createHarness(extension, [
    messageEntry("assistant", usage(1200, 300, 400, 50, 0.125)),
    messageEntry("toolResult", usage(10, 20, 0, 0, 0.005)),
  ], {
    statuses: [["z", "line\n status"], ["mcp", "3 MCP servers"], ["a", "ready"]],
    sessionName: "Named session",
  });

  await harness.emit("session_start", { reason: "startup" });
  const lines = harness.component().render(120);

  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\/home\/example\/project \(main\) • Named session/);
  assert.match(lines[0], /sid session-123$/);
  assert.match(lines[1], /↑1\.2k ↓320 R400 W50 \$0\.130 25\.0%\/100k \(auto\)/);
  assert.match(lines[1], /\(test\) gpt-test • high$/);
  assert.equal(lines[2], "ready line status");
});

test("shortens UUID session ids to a valid pi --session prefix by default", async () => {
  const harness = createHarness(extension, [], { sessionId: "019fcc94-7f10-7545-a925-95943c353243" });
  await harness.emit("session_start", { reason: "startup" });
  assert.match(harness.component().render(80)[0], /sid 019fcc94-7f10-7545$/);
});

test("shows full UUID session ids when configured", async () => {
  const previous = process.env.PI_SESSION_ID_FOOTER_FORMAT;
  process.env.PI_SESSION_ID_FOOTER_FORMAT = "full";
  try {
    const harness = createHarness(extension, [], { sessionId: "019fcc94-7f10-7545-a925-95943c353243" });
    await harness.emit("session_start", { reason: "startup" });
    assert.match(harness.component().render(100)[0], /sid 019fcc94-7f10-7545-a925-95943c353243$/);
  } finally {
    if (previous === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
    else process.env.PI_SESSION_ID_FOOTER_FORMAT = previous;
  }
});

test("falls back to the short form for an invalid configuration", async () => {
  const previous = process.env.PI_SESSION_ID_FOOTER_FORMAT;
  process.env.PI_SESSION_ID_FOOTER_FORMAT = "invalid";
  try {
    const harness = createHarness(extension, [], { sessionId: "019fcc94-7f10-7545-a925-95943c353243" });
    await harness.emit("session_start", { reason: "startup" });
    assert.match(harness.component().render(80)[0], /sid 019fcc94-7f10-7545$/);
  } finally {
    if (previous === undefined) delete process.env.PI_SESSION_ID_FOOTER_FORMAT;
    else process.env.PI_SESSION_ID_FOOTER_FORMAT = previous;
  }
});

test("shows unsaved session label", async () => {
  const harness = createHarness(extension, [], { saved: false, statuses: [["mcp", "hidden"]] });
  await harness.emit("session_start", { reason: "startup" });
  const lines = harness.component().render(80);
  assert.match(lines[0], /sid unsaved$/);
  assert.equal(lines.length, 2);
});

test("scans entries once and accumulates new usage without reinstalling footer", async () => {
  const harness = createHarness(extension, Array.from({ length: 10000 }, () => messageEntry("assistant", usage(1, 2))));
  await harness.emit("session_start", { reason: "startup" });
  const component = harness.component();

  component.render(100);
  component.render(100);
  await harness.emit("message_end", { message: { role: "assistant", usage: usage(7, 11, 3, 5, 0.25) } });
  await harness.emit("turn_end", { turnIndex: 0, message: { role: "assistant" }, toolResults: [] });
  const lines = component.render(100);

  assert.deepEqual(harness.metrics(), { setFooterCalls: 1, rendersRequested: 0, getEntriesCalls: 1 });
  assert.match(lines[1], /↑10k ↓20k R3 W5 \$0\.250/);
});

test("updates a renamed session without rescanning entries", async () => {
  const harness = createHarness(extension, []);
  await harness.emit("session_start", { reason: "startup" });
  const component = harness.component();
  await harness.emit("session_info_changed", { name: "Renamed" });
  assert.match(component.render(80)[0], /• Renamed/);
  assert.equal(harness.metrics().getEntriesCalls, 1);
});

test("preserves custom footer and appends session id", async () => {
  const harness = createHarness(extension, []);
  await harness.emit("session_start", { reason: "startup" });
  harness.ui.setFooter(() => ({ render: () => ["custom first", "custom second"], invalidate() {} }));
  const lines = harness.component().render(60);
  assert.match(lines[0], /^custom first +sid session-123$/);
  assert.equal(lines[1], "custom second");
});
