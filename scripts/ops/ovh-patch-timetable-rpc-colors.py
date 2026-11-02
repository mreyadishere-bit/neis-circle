#!/usr/bin/env python3
"""Safely patch only the timetable RPC color handling on OVH.

No student tables are read or modified; pg_get_functiondef supplies the live
definition. Transactional replace; immutable private backup for rollback.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import uuid

CONTAINER = "supabase-db"
DOCKER = ["sudo", "-n", "/usr/bin/docker"]
BACKUP_ROOT = Path("/home/ubuntu/neis-backups")
FUNC = "apply_timetable_ai_plan"


def postgres(query: str) -> str:
    result = subprocess.run(
        DOCKER + ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
                  "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
        text=True, capture_output=True, timeout=50,
    )
    if result.returncode:
        # Do not log query, exceptions, credentials, SQL source, or user data.
        raise RuntimeError("TIMETABLE_RPC_DATABASE_COMMAND_FAILED")
    return result.stdout


def read_function() -> str:
    source = postgres(
        "select pg_get_functiondef(p.oid) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='" + FUNC + "' "
        "and p.pronargs=2 limit 1"
    ).strip()
    if not source.startswith("CREATE OR REPLACE FUNCTION public.apply_timetable_ai_plan("):
        raise RuntimeError("EXPECTED_TIMETABLE_RPC_NOT_FOUND")
    return source


def patch_function(source: str) -> str:
    """Fail closed if the live function differs from the vetted signature."""
    if ("color=coalesce(item->>'color','#2f7db8')" in source and
            "coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8')" in source):
        return source

    needle1 = "category=coalesce(item->>'category','Class')\n"
    if source.count(needle1) != 1:
        raise ValueError("RPC_UPDATE_COLOR_ANCHOR_CHANGED")
    source = source.replace(
        needle1,
        "category=coalesce(item->>'category','Class'),\n"
        "color=coalesce(item->>'color','#2f7db8')\n",
        1,
    )
    needle2 = "(title,day_of_week,start_time,end_time,location,notes,category) is distinct from"
    if source.count(needle2) != 1:
        raise ValueError("RPC_COMPARE_COLOR_ANCHOR_CHANGED")
    source = source.replace(
        needle2,
        "(title,day_of_week,start_time,end_time,location,notes,category,color) is distinct from",
        1,
    )
    needle3 = "coalesce(item->>'category','Class'));\n"
    if source.count(needle3) != 1:
        raise ValueError("RPC_COMPARE_VALUES_ANCHOR_CHANGED")
    source = source.replace(
        needle3,
        "coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8'));\n",
        1,
    )
    needle4 = "coalesce(item->>'category','Class'),'#2f7db8',false,15)"
    if source.count(needle4) != 1:
        raise ValueError("RPC_INSERT_COLOR_ANCHOR_CHANGED")
    source = source.replace(
        needle4,
        "coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8'),false,15)",
        1,
    )
    # Validate color rather than relying on a constraint failure later.
    needle5 = "('Class','Lab','Study','Exam','Activity','Other') then"
    if source.count(needle5) != 1:
        raise ValueError("RPC_COLOR_VALIDATION_ANCHOR_CHANGED")
    source = source.replace(
        needle5,
        "('Class','Lab','Study','Exam','Activity','Other')\n"
        "or coalesce(item->>'color','#2f7db8') !~ '^#[0-9A-Fa-f]{6}$' then",
        1,
    )
    return source


def main() -> None:
    old = read_function()
    new = patch_function(old)
    if new == old:
        print("TIMETABLE_RPC_COLORS=ALREADY_FIXED")
        return
    if os.environ.get("TIMETABLE_RPC_DRY_RUN") == "1":
        print("TIMETABLE_RPC_PATCH_PREFLIGHT=READY")
        return

    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_ROOT / ("timetable-rpc-before-color-fix-" + uuid.uuid4().hex[:16] + ".sql")
    fd = os.open(str(backup), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(old + ";\n")

    try:
        postgres("BEGIN;\n" + new.rstrip().rstrip(";") + ";\nCOMMIT;")
        running = read_function()
        if patch_function(running) != running:
            raise RuntimeError("RPC_COLOR_PATCH_VERIFICATION_FAILED")
        if ("color=coalesce(item->>'color','#2f7db8')" not in running or
            "coalesce(item->>'category','Class'),coalesce(item->>'color','#2f7db8')" not in running):
            raise RuntimeError("RPC_COLOR_PATCH_VERIFICATION_FAILED")
    except Exception:
        # Prior SQL definition is backed up and restored if verification fails.
        try:
            postgres("BEGIN;\n" + old.rstrip().rstrip(";") + ";\nCOMMIT;")
            print("TIMETABLE_RPC_ROLLBACK=SUCCESS")
        except Exception:
            print("TIMETABLE_RPC_ROLLBACK=MANUAL_RESTORE_REQUIRED")
        raise

    print("TIMETABLE_RPC_INSERT_COLOR=FIXED")
    print("TIMETABLE_RPC_UPDATE_COLOR=FIXED")
    print("TIMETABLE_RPC_COLOR_VALIDATION=ENFORCED")
    print("TIMETABLE_RPC_EXISTING_ROWS=UNTOUCHED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("TIMETABLE_RPC_PATCH=FAILED_" + type(error).__name__)
        raise SystemExit(1)
