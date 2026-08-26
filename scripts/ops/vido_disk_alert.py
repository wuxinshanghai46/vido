#!/usr/bin/env python3
"""Monitor selected filesystems and send deduplicated SMTP alerts."""

import argparse
import json
import os
import shutil
import smtplib
import socket
import ssl
import sys
import time
from email.message import EmailMessage
from pathlib import Path


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        raise SystemExit(f"invalid integer environment variable: {name}")


def load_state(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def usage_percent(path):
    usage = shutil.disk_usage(path)
    percent = usage.used * 100.0 / usage.total if usage.total else 0.0
    return usage.total, usage.used, usage.free, percent


def gib(value):
    return f"{value / (1024 ** 3):.1f} GiB"


def smtp_send(subject, body):
    host = os.environ.get("VIDO_DISK_ALERT_SMTP_HOST", "smtp.gmail.com").strip()
    port = env_int("VIDO_DISK_ALERT_SMTP_PORT", 587)
    username = os.environ.get("VIDO_DISK_ALERT_SMTP_USER", "").strip()
    password = os.environ.get("VIDO_DISK_ALERT_SMTP_PASSWORD", "")
    sender = os.environ.get("VIDO_DISK_ALERT_FROM", username).strip()
    recipient = os.environ.get("VIDO_DISK_ALERT_RECIPIENT", "").strip()
    if not all((host, username, password, sender, recipient)):
        raise RuntimeError("SMTP configuration is incomplete")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as client:
            client.login(username, password)
            client.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=20) as client:
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
            client.login(username, password)
            client.send_message(message)


def planned_event(previous, percent, threshold, recovery, repeat_seconds, now):
    status = previous.get("status", "normal")
    last_alert = int(previous.get("last_alert_at", 0) or 0)
    if percent >= threshold:
        if status != "alert" or now - last_alert >= repeat_seconds:
            return "alert"
    elif status == "alert" and percent <= recovery:
        return "recovery"
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", action="append", dest="paths")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--test-percent", type=float)
    args = parser.parse_args()

    paths = args.paths or ["/", "/data"]
    threshold = env_int("VIDO_DISK_ALERT_THRESHOLD", 80)
    recovery = env_int("VIDO_DISK_ALERT_RECOVERY_THRESHOLD", 75)
    repeat_seconds = env_int("VIDO_DISK_ALERT_REPEAT_SECONDS", 86400)
    state_path = Path(os.environ.get(
        "VIDO_DISK_ALERT_STATE_FILE", "/data/vido/monitoring/disk-alert-state.json"
    ))
    if not 1 <= recovery < threshold <= 100:
        raise SystemExit("thresholds must satisfy 1 <= recovery < alert <= 100")

    now = int(time.time())
    state = load_state(state_path)
    hostname = socket.gethostname()
    changed = False
    failures = []

    for path in paths:
        try:
            total, used, free, measured = usage_percent(path)
        except OSError as exc:
            failures.append(f"{path}: {exc}")
            continue
        percent = args.test_percent if args.test_percent is not None else measured
        previous = state.get(path, {})
        event = planned_event(previous, percent, threshold, recovery, repeat_seconds, now)
        print(f"{path}: {percent:.1f}% used, free={gib(free)}, event={event or 'none'}")
        if event:
            label = "磁盘空间告警" if event == "alert" else "磁盘空间恢复"
            subject = f"[VIDO] {label}: {hostname} {path} {percent:.1f}%"
            body = (
                f"主机: {hostname}\n挂载点: {path}\n使用率: {percent:.1f}%\n"
                f"告警阈值: {threshold}%\n恢复阈值: {recovery}%\n"
                f"总容量: {gib(total)}\n已使用: {gib(used)}\n可用: {gib(free)}\n"
            )
            if args.dry_run:
                print(f"DRY RUN: {subject}")
            else:
                try:
                    smtp_send(subject, body)
                except Exception as exc:  # retry next timer run; never mark as sent
                    failures.append(f"{path}: email delivery failed: {exc}")
                    continue
            previous["status"] = "alert" if event == "alert" else "normal"
            previous["last_alert_at" if event == "alert" else "last_recovery_at"] = now
            changed = True
        previous.update({"last_checked_at": now, "last_percent": round(percent, 2)})
        state[path] = previous
        changed = True

    if changed and not args.dry_run:
        save_state(state_path, state)
    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
