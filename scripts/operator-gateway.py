#!/usr/bin/python3
"""Root-owned forced-command gateway. No shell, caller paths, SQL or deploy actions."""
import json
import os
import signal
import subprocess
import sys

COMPOSE = ["/usr/bin/docker", "compose", "--project-directory", "/home/alexh/lastpeek-deploy", "-p", "lastpeek"]


def run(args, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=20,
                            env={"PATH": "/usr/bin:/bin", "HOME": "/root"})
    if result.returncode:
        raise ValueError("Service unavailable or operator CLI not deployed.")
    if len(result.stdout) > 1_000_000:
        raise ValueError("Service output exceeded limit.")
    return result.stdout


def dispatch(command, role):
    action = command.get("action")
    fields = {
        "service_status": {"action"},
        "recent_logs": {"action", "minutes", "lines"},
        "feature_access": {"action", "email"},
        "set_feature_access": {"action", "email", "feature", "enabled", "reason", "thread"},
    }
    if action not in fields or set(command) - fields[action]:
        raise ValueError("Unknown command or fields.")
    if action == "set_feature_access" and role != "flags":
        raise ValueError("Flag-write credential required.")
    if action in ("feature_access", "set_feature_access"):
        # Full field validation is repeated inside the application CLI.
        return json.loads(run(COMPOSE + ["exec", "-T", "-e", "LASTPEEK_OPERATOR_ROLE=" + role,
            "-e", "LASTPEEK_OPERATOR_ACTOR=ssh:lastpeek-" + role,
            "web", "npm", "run", "--silent", "operator"], json.dumps(command)))
    if action == "service_status":
        rows = run(COMPOSE + ["ps", "--format", "json"])
        try:
            services = json.loads(rows)
            if not isinstance(services, list):
                services = [services]
        except json.JSONDecodeError:
            services = [json.loads(line) for line in rows.splitlines() if line.strip()]
        return {"ok": True, "result": [{key: row.get(key) for key in ("Service", "State", "Health")} for row in services]}
    minutes, lines = command.get("minutes"), command.get("lines")
    if type(minutes) is not int or not 1 <= minutes <= 60 or type(lines) is not int or not 1 <= lines <= 200:
        raise ValueError("Logs require minutes 1–60 and lines 1–200.")
    raw = run(COMPOSE + ["logs", "--no-color", "--no-log-prefix", "--since", str(minutes) + "m", "--tail", str(lines), "web"])
    events = []
    for line in raw.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        # Project only known enum/numeric metadata; never relay free-form log strings.
        if not isinstance(event, dict) or event.get("event") != "ai_request":
            continue
        safe = {"event": "ai_request"}
        if event.get("outcome") in ("success", "error", "incomplete"):
            safe["outcome"] = event["outcome"]
        for key in ("latency_ms", "input_tokens", "output_tokens", "http_status"):
            value = event.get(key)
            if type(value) in (int, float) and 0 <= value < 1_000_000_000:
                safe[key] = value
        events.append(safe)
    return {"ok": True, "result": events[-lines:]}


def main():
    signal.alarm(30)
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("read", "flags") or os.environ.get("SSH_ORIGINAL_COMMAND"):
            raise ValueError("Forced-command access only.")
        raw = sys.stdin.buffer.read(4097)
        if len(raw) > 4096:
            raise ValueError("Request too large.")
        command = json.loads(raw)
        if not isinstance(command, dict):
            raise ValueError("Expected an object.")
        print(json.dumps(dispatch(command, sys.argv[1])))
    except Exception:
        print(json.dumps({"ok": False, "error": "Request rejected or service unavailable; check role, command and deployed CLI."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
