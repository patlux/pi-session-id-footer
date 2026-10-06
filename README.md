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

The extension leaves Pi's built-in footer unchanged and adds the session id through `ctx.ui.setStatus()`. It appears in the extension-status line below the token/model line, alongside other extension statuses:

```txt
sid 019fcc94-7f10-7545
```

Token usage, cache-hit rate (`CH…%`, when supported by Pi), context usage, costs, and model information are rendered by Pi itself. The extension does not copy or replace that rendering logic.

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

- The extension never calls or overrides `setFooter()`. It adds only its own status entry and removes it on shutdown.
- Other extension statuses, including MCP server counts, remain visible. Pi controls sorting and truncation at narrow terminal widths.
- Short/full session-id configuration is unchanged. New, switched, and resumed sessions refresh the status; unsaved sessions refresh after a completed turn.
- It does not scan history, calculate token statistics, or modify sessions.
- The legacy custom renderer is no longer a package entry point. Its existing benchmark and tests cover only that inactive implementation.
