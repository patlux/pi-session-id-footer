export function usage(input, output, cacheRead = 0, cacheWrite = 0, cost = 0) {
  return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } };
}

export function messageEntry(role, messageUsage) {
  return { type: "message", id: crypto.randomUUID(), parentId: null, timestamp: new Date(0).toISOString(), message: { role, usage: messageUsage } };
}

export function createHarness(extension, entries, options = {}) {
  const handlers = new Map();
  let footerFactory;
  let setFooterCalls = 0;
  let rendersRequested = 0;
  let getEntriesCalls = 0;
  const statuses = new Map(options.statuses ?? []);
  if (options.sessionName) {
    entries.push({ type: "session_info", id: crypto.randomUUID(), parentId: null, timestamp: new Date(0).toISOString(), name: options.sessionName });
  }

  const originalSetFooter = (factory) => {
    setFooterCalls++;
    footerFactory = factory;
  };
  const ui = { setFooter: originalSetFooter, theme: { fg: (_color, text) => text } };
  const sessionManager = {
    getEntries() { getEntriesCalls++; return entries.filter((entry) => entry.type !== "session"); },
    getSessionFile: () => options.saved === false ? undefined : "/tmp/session.jsonl",
    getSessionId: () => options.sessionId ?? "session-123",
    getCwd: () => options.cwd ?? "/home/example/project",
    getSessionName: () => options.sessionName,
  };
  const ctx = {
    hasUI: true,
    ui,
    sessionManager,
    model: { id: "gpt-test", provider: "test", reasoning: true, contextWindow: 100000 },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => ({ tokens: 25000, contextWindow: 100000, percent: 25 }),
  };
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    getThinkingLevel: () => "high",
  };

  extension(pi);

  const emit = async (name, event = {}) => {
    const handler = handlers.get(name);
    if (handler) await handler({ type: name, ...event }, ctx);
  };
  const component = () => footerFactory(
    { requestRender() { rendersRequested++; } },
    ui.theme,
    {
      getGitBranch: () => options.branch ?? "main",
      getExtensionStatuses: () => statuses,
      getAvailableProviderCount: () => 2,
      onBranchChange: () => () => {},
    },
  );

  return {
    ctx,
    emit,
    component,
    statuses,
    ui,
    metrics: () => ({ setFooterCalls, rendersRequested, getEntriesCalls }),
  };
}
