# Footer performance benchmark

Run from this directory with Node 22+:

```sh
cp src/index.ts /tmp/final.ts
# Put the pre-change source at /tmp/baseline.ts, then:
node --expose-gc --experimental-strip-types test/real-session-benchmark.mjs /tmp/baseline.ts SESSION.jsonl 500
node --expose-gc --experimental-strip-types test/real-session-benchmark.mjs /tmp/final.ts SESSION.jsonl 500
```

For synthetic repeatability without private session files:

```sh
node --expose-gc --experimental-strip-types test/benchmark.mjs src/index.ts 20 2000
node --expose-gc --experimental-strip-types test/benchmark.mjs src/index.ts 20000 2000
```

`getEntriesCalls` is the focused allocation signal: `SessionManager.getEntries()` filters the complete in-memory entry array and returns a new shallow array. The optimized footer should call it once at session startup, not once per render.
