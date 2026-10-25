#!/usr/bin/env python3
"""
Создаёт задачи плана Kaitos в GitHub issues.

Использование (из корня репозитория):
    python3 plan/create_issues.py            # создать недостающие задачи
    python3 plan/create_issues.py --dry-run  # только показать, что будет создано

Требуется gh CLI с правом создания issues в репозитории koolo4/kaitos.
Скрипт идемпотентен: задачи, чей заголовок уже есть среди открытых и закрытых issues, не создаются повторно.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = "koolo4/kaitos"
LABEL = "justai"


def gh(*args):
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        print("Ошибка gh:", result.stderr.strip(), file=sys.stderr)
        raise SystemExit(result.returncode)
    return result.stdout.strip()


def existing_titles():
    raw = gh("issue", "list", "--repo", REPO, "--state", "all", "--limit", "300", "--json", "title")
    return {item["title"] for item in json.loads(raw)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    known = existing_titles()
    numbers = {}

    # уже существующие задачи находим по заголовку, чтобы корректно проставить Depends on
    if known:
        for item in json.loads(
            gh("issue", "list", "--repo", REPO, "--state", "all", "--limit", "300", "--json", "number,title")
        ):
            for task in manifest:
                if item["title"] == task["title"]:
                    numbers[task["key"]] = item["number"]

    for task in manifest:
        if task["key"] in numbers:
            print(f"= #{numbers[task['key']]} уже есть: {task['title']}")
            continue

        body = (ROOT / task["file"]).read_text(encoding="utf-8").rstrip()
        deps = [numbers[key] for key in task["deps"] if key in numbers]
        missing = [key for key in task["deps"] if key not in numbers]
        if missing:
            print(f"! {task['key']}: не найдены зависимости {missing} — она будет создана после них")
        if deps:
            body += "\n\nDepends on " + ", ".join(f"#{n}" for n in deps) + "\n"

        if args.dry_run:
            print(f"+ {task['title']}  (deps={deps}, {len(body)} символов)")
            continue

        url = gh(
            "issue", "create",
            "--repo", REPO,
            "--title", task["title"],
            "--body", body,
            "--label", LABEL,
        )
        number = int(url.rstrip("/").split("/")[-1])
        numbers[task["key"]] = number
        print(f"+ #{number} {task['title']}  deps={deps}")


if __name__ == "__main__":
    main()
