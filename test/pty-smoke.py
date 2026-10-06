#!/usr/bin/env python3
"""Offline real-CLI smoke test; synthetic sessions/config only, no model calls."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", required=True, help="Absolute Node or Bun executable")
parser.add_argument("--pi-root", required=True, type=Path, help="Installed pi-coding-agent package")
args = parser.parse_args()
extension = Path(__file__).resolve().parents[1] / "src/status.ts"

with tempfile.TemporaryDirectory(prefix="pi-footer-smoke-") as temp:
    root = Path(temp)
    agent = root / "agent"
    agent.mkdir()
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "theme": "dark"}))
    timestamp = "2026-01-01T00:00:00.000Z"
    for mode in ("regular", "fullscreen"):
        fixture = root / f"{mode}.jsonl"
        entries = [
            {"type": "session", "version": 3, "id": "019fcc94-7f10-7545-a925-95943c353243", "timestamp": timestamp, "cwd": temp},
            {"type": "model_change", "provider": "openai", "modelId": "gpt-4.1"},
            {"type": "thinking_level_change", "thinkingLevel": "off"},
            {"type": "session_info", "name": "Footer layout smoke"},
            {"type": "message", "message": {
                "role": "assistant", "content": [{"type": "text", "text": "Synthetic test session; no model request."}],
                "api": "openai-responses", "provider": "openai", "model": "gpt-4.1",
                "usage": {"input": 100, "output": 20, "cacheRead": 900, "cacheWrite": 0, "totalTokens": 1020,
                          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}},
                "stopReason": "stop", "timestamp": 1767225600000,
            }},
        ]
        for index, entry in enumerate(entries[1:], start=1):
            entry.update(id=f"entry{index}", parentId=f"entry{index - 1}" if index > 1 else None, timestamp=timestamp)
        fixture.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n")
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 160, 0, 0))
        environment = {
            "PATH": os.environ["PATH"], "HOME": temp, "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "PI_CODING_AGENT_DIR": str(agent), "PI_PACKAGE_DIR": str(args.pi_root),
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
        }
        command = [args.runtime, str(args.pi_root / "dist/cli.js"), "--offline", "--no-extensions",
                   "--extension", str(extension), "--no-skills", "--no-prompt-templates", "--no-themes",
                   "--no-context-files", "--no-tools", "--no-approve", "--session", str(fixture),
                   "--provider", "openai", "--model", "gpt-4.1", "--tui-mode", mode]
        process = subprocess.Popen(command, cwd=root, env=environment, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        deadline = time.monotonic() + 20
        quit_sent = False
        passed = False
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                output.extend(chunk)
            decoded = output.decode("utf-8", errors="replace")
            if not quit_sent and "sid 019fcc94-7f10-7545" in decoded and "CH90.0%" in decoded:
                passed = True
                os.write(master, b"/quit\r")
                quit_sent = True
            if not quit_sent and deadline - time.monotonic() < 5:
                os.write(master, b"/quit\r")
                quit_sent = True
            if process.poll() is not None:
                break
        # Use Pi's own quit command, never process-name or PID-based termination.
        if process.poll() is None:
            os.write(master, b"/quit\r")
            process.wait(timeout=5)
        os.close(master)
        decoded = output.decode("utf-8", errors="replace")
        clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", decoded)
        assert process.returncode == 0, (mode, process.returncode, clean[-4000:])
        assert passed, (mode, "Footer not rendered with native cache-hit rate and session label", clean[-4000:])
        assert "built-in footer not found" not in decoded, clean[-4000:]
        assert "Footer layout smoke" in decoded, clean[-4000:]
        print(f"{mode}: real CLI rendered named synthetic session, native CH90.0%, right-hand sid; graceful exit 0")
