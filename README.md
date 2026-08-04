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

The default footer keeps its normal layout and adds a short session id right-aligned on the folder/branch line:

```txt
~/dev/project (main)                                      sid 019fcc94-7f10-7545
```

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

- The extension preserves Pi's normal footer content and status lines.
- Status lines from other extensions, such as MCP server counts, remain below the model/context line.
- It does not modify sessions.
