import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createHarness, messageEntry, usage } from "./harness.mjs";

const source = process.argv[2];
const entryCount = Number(process.argv[3] ?? 10000);
const renderCount = Number(process.argv[4] ?? 1000);
if (!source) throw new Error("usage: benchmark.mjs SOURCE [ENTRIES] [RENDERS]");

const extension = (await import(pathToFileURL(source).href)).default;
const entries = Array.from({ length: entryCount }, (_, index) => messageEntry("assistant", usage(index % 20, index % 11, index % 7, index % 3, 0.0001)));
const harness = createHarness(extension, entries, { statuses: [["a", "ready"], ["mcp", "hidden"]] });
await harness.emit("session_start", { reason: "startup" });
const component = harness.component();

if (global.gc) global.gc();
const heapBefore = process.memoryUsage().heapUsed;
const started = performance.now();
for (let index = 0; index < renderCount; index++) component.render(index % 2 === 0 ? 120 : 121);
const elapsedMs = performance.now() - started;
if (global.gc) global.gc();
const heapAfter = process.memoryUsage().heapUsed;

console.log(JSON.stringify({ source, entryCount, renderCount, elapsedMs, heapDelta: heapAfter - heapBefore, ...harness.metrics() }));
