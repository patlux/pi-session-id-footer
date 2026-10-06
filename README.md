# pi-session-id-footer

A small [pi](https://pi.dev) extension that shows the current Pi session id in the footer.

This is useful when you want to fork or resume the session later without running `/session` first.

## Install

```sh
pi install npm:pi-session-id-footer
```

Reload an already-running Pi process:

```txt
/reload
```

The extension keeps Pi's built-in footer and adds a dim session id right-aligned on its first line, beside the folder, branch, and session name. It adds no extra status row.

Token usage, cache-hit rate (`CH…%`, when supported by Pi), context usage, costs, and model information are rendered by Pi itself. Those lines are passed through unchanged; the extension does not copy or replace their rendering logic.

The short id is a UUID prefix accepted by `pi --session <id>`.

## Configuration

Set `PI_SESSION_ID_FOOTER_FORMAT` before starting Pi:

| Value | Display |
|---|---|
| `short` | First three UUID groups, for example `019fcc94-7f10-7545` (default) |
| `full` | Complete session UUID |

Example:

```sh
PI_SESSION_ID_FOOTER_FORMAT=full pi
```

Unknown values fall back to `short`.

Ephemeral sessions show:

```txt
sid unsaved
```

## Notes

- The extension never calls or overrides `setFooter()`. Pi currently has no public footer-decorator API, so a zero-row below-editor widget obtains the live TUI and finds its mounted `FooterComponent`. Only that instance's first rendered line is decorated; the original method is restored on disposal. The global prototype is untouched.
- If the built-in component cannot be identified, the extension warns and leaves the current footer alone. Custom footer implementations are not replaced.
- Other extension statuses remain unchanged. To hide the MCP adapter's persistent status, configure its own `settings.mcpFooterStatus` as `"off"`; this extension does not filter it.
- Short/full session-id configuration is unchanged. The label uses current session metadata on each render, including newly saved sessions.
- It does not scan history, calculate token statistics, or modify sessions. Pi remains responsible for native statistics and model/context updates.
- The legacy custom renderer is no longer a package entry point. Its existing benchmark and tests cover only that inactive implementation.
