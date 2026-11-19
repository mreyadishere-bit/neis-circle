#!/usr/bin/env python3
"""Rollback only the verified root/Circles original-ratio OG release on failure."""
from pathlib import Path
import os, re, subprocess, sys

ROOT = Path("/home/ubuntu/neis-supabase")
STAGE = Path("/home/ubuntu/neis-backups/original-ratio-social-20261119")
RELEASES = Path("/home/ubuntu/neis-frontend/releases")
OVERLAY = ROOT / "docker-compose.frontend-public.yml"
DOCKER = ["sudo", "-n", "/usr/bin/docker"]
COMPOSE = DOCKER + ["compose"] + [item for f in (
    "docker-compose.yml", "docker-compose.security.yml", "docker-compose.caddy.yml",
    "docker-compose.frontend-public.yml", "docker-compose.auth-public-direct.yml"
) for item in ("-f", f)]

try:
    rev = os.getenv("GITHUB_SHA", "")[:12]
    assert re.fullmatch(r"[a-f0-9]{12}", rev), "INVALID_SHA"
    destination = RELEASES / ("original-ratio-og-" + rev)
    backup = STAGE / ("previous-release-" + rev + ".txt")
    if not backup.exists():
        print("ORIGINAL_RATIO_ROLLBACK=NO_DEPLOYMENT")
        sys.exit(0)
    old = Path(backup.read_text().strip())
    assert old.parent == RELEASES and old.is_dir(), "INVALID_PREVIOUS_RELEASE"
    current_overlay = OVERLAY.read_text()
    if str(destination) not in current_overlay:
        print("ORIGINAL_RATIO_ROLLBACK=NOT_ACTIVE")
        sys.exit(0)
    assert current_overlay.count(str(destination)) == 1, "UNEXPECTED_NEWER_RELEASE"
    OVERLAY.write_text(current_overlay.replace(str(destination), str(old), 1))
    process = subprocess.run(COMPOSE + ["up", "-d", "--no-deps", "caddy"],
                             cwd=ROOT, capture_output=True, text=True, timeout=180)
    if process.returncode:
        OVERLAY.write_text(current_overlay)
        raise RuntimeError("ROLLBACK_RESTART_FAILED_" + process.stderr[-160:])
    print("ORIGINAL_RATIO_ROLLBACK=COMPLETE")
except Exception as error:
    print("ORIGINAL_RATIO_ROLLBACK=FAILED_" + str(error)[:220], file=sys.stderr)
    sys.exit(1)
