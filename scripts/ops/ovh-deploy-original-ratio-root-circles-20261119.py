#!/usr/bin/env python3
"""Fix only root and Circles OG images, retaining EXACT original 1491x1055 ratio.

Do not change NEIS app UI, other share pictures, route redirects, auth,
Caddyfile, student data, user profile, or /home media.

Requires two JPEGs generated directly from user's original art (no cropping).
Copies current OVH frontend release atomically and rolls back on local failure.
"""
from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, sys

ROOT = Path("/home/ubuntu/neis-supabase")
RELEASES = Path("/home/ubuntu/neis-frontend/releases")
OVERLAY = ROOT / "docker-compose.frontend-public.yml"
STAGE = Path("/home/ubuntu/neis-backups/original-ratio-social-20261119")
DOCKER = ["sudo", "-n", "/usr/bin/docker"]
COMPOSE = DOCKER + ["compose"] + [v for f in (
    "docker-compose.yml", "docker-compose.security.yml", "docker-compose.caddy.yml",
    "docker-compose.frontend-public.yml", "docker-compose.auth-public-direct.yml"
) for v in ("-f", f)]
ASSETS = ("home-boys-original.jpg", "circles-girls-original.jpg")
VERSION = "20261119-authentic-proportions"
OG_ROOT = "https://neiscircle.site/assets/share-link/home-boys-original.jpg?v=" + VERSION
OG_CIRCLES = "https://neiscircle.site/assets/share-link/circles-girls-original.jpg?v=" + VERSION


def ensure(ok, message):
    if not ok:
        raise RuntimeError(message)


def command(args, timeout=100):
    p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError("COMMAND_FAILED_" + (p.stderr or "")[-300:])
    return p.stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_jpeg(path):
    data = path.read_bytes()
    ensure(len(data) > 30000 and data[:3] == b"\xff\xd8\xff", "MISSING_OR_INVALID_JPEG_" + path.name)
    # ImageMagick is not required on the production server. GitHub CI checks exact dimensions.
    ensure(len(data) < 2_000_000, "JPG_UNEXPECTED_SIZE_" + path.name)


def meta(content, key, value, kind="property", required=True):
    match = re.compile(r'(<meta\s+' + kind + r'="' + re.escape(key) +
                       r'"\s+content=")[^"]*(")', re.I)
    result, count = match.subn(lambda m: m.group(1) + value + m.group(2), content, count=1)
    if not count:
        ensure(not required, "EXPECTED_META_MISSING_" + key)
        anchor = re.search(r'<meta\s+property="og:image"[^>]*>', result)
        ensure(anchor is not None, "NO_OG_IMAGE_ANCHOR")
        result = result[:anchor.end()] + '\n  <meta ' + kind + '="' + key + \
                 '" content="' + value + '">' + result[anchor.end():]
    return result


def change_og(content, image_url, label):
    result = content
    for prop, val in (
        ("og:image", image_url),
        ("og:image:secure_url", image_url),
        ("og:image:type", "image/jpeg"),
        ("og:image:width", "1491"),
        ("og:image:height", "1055"),
        ("og:image:alt", label)
    ):
        result = meta(result, prop, val, required=prop not in ("og:image:width", "og:image:height"))
    result = meta(result, "twitter:image", image_url, kind="name")
    ensure(image_url in result, "IMAGE_URL_NOT_STORED")
    ensure('content="1491"' in result and 'content="1055"' in result, "ORIGINAL_DIMENSIONS_MISSING")
    return result


def main():
    revision = os.environ.get("GITHUB_SHA", "")[:12]
    ensure(bool(re.fullmatch(r"[0-9a-f]{12}", revision)), "INVALID_RELEASE_SHA")
    ensure(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(), "OVH_SITE_FOLDERS_MISSING")
    for name in ASSETS:
        check_jpeg(STAGE / name)

    command(COMPOSE + ["config", "--quiet"], timeout=60)
    info = json.loads(command(DOCKER + ["inspect", "supabase-caddy"], timeout=30))[0]
    mounts = [
        Path(m["Source"]) for m in info.get("Mounts", [])
        if m.get("Destination") == "/srv/neis-circle" and m.get("Type") == "bind"
    ]
    ensure(len(mounts) == 1, "LIVE_FRONTEND_MOUNT_AMBIGUOUS")
    existing = mounts[0]
    original_overlay = OVERLAY.read_text()
    ensure(existing.parent == RELEASES and existing.is_dir() and
           original_overlay.count(str(existing)) == 1, "LIVE_RELEASE_UNKNOWN")

    old_index = (existing / "index.html").read_text()
    old_circles = (existing / "circles.html").read_text()
    ensure("scripts/hash-route-open-v1.js" in old_index and
           "scripts/03-auth-i18n.js" in old_index and
           "scripts/user-activity-v1.js" in old_index, "PRODUCTION_APP_UNEXPECTED")
    ensure("window.location.replace('/#/circles');" in old_circles and
           'property="og:title" content="Circles | NEIS Circle"' in old_circles and
           'property="og:url" content="https://neiscircle.site/circles"' in old_circles,
           "CIRCLES_ROUTE_OR_SOCIAL_PAGE_UNEXPECTED")

    # Verify original Caddy clean-link rewrites exist. Do NOT modify Caddy config.
    configs = [
        Path(m["Source"]) for m in info.get("Mounts", [])
        if m.get("Destination") == "/etc/caddy/Caddyfile" and m.get("Type") == "bind"
    ]
    ensure(len(configs) == 1 and configs[0].is_file(), "ACTIVE_CADDY_CONFIG_NOT_FOUND")
    caddy_source = configs[0].read_text()
    ensure("rewrite /circles /circles.html" in caddy_source, "CIRCLES_CLEAN_ROUTE_MISSING")
    ensure('https://neiscircle.site/' in old_index, "MAIN_SITE_OG_MISSING")

    before_count = sum(path.is_file() for path in existing.rglob("*"))
    ensure(before_count > 120, "SOURCE_RELEASE_INCOMPLETE")

    destination = RELEASES / ("original-ratio-og-" + revision)
    temporary = Path(str(destination) + ".building")
    ensure(not destination.exists() and not temporary.exists(), "RELEASE_ALREADY_EXISTS")
    shutil.copytree(existing, temporary)
    (temporary / "assets/share-link").mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        shutil.copy2(STAGE / name, temporary / "assets/share-link" / name)
    updated_index = change_og(
        old_index, OG_ROOT,
        "NEIS Circle — three student friends, original undistorted illustration"
    )
    updated_circles = change_og(
        old_circles, OG_CIRCLES,
        "NEIS Circle Circles — two students with notebooks and camera"
    )
    (temporary / "index.html").write_text(updated_index)
    (temporary / "circles.html").write_text(updated_circles)
    ensure('window.location.replace(\'/#/circles\');' in updated_circles,
           "ORIGINAL_CIRCLES_HASH_LINK_CHANGED")

    # Check every preexisting asset except the two targeted metadata documents.
    for file in existing.rglob("*"):
        if not file.is_file():
            continue
        relative = file.relative_to(existing)
        if str(relative) in ("index.html", "circles.html"):
            continue
        ensure(digest(file) == digest(temporary / relative),
               "UNRELATED_FILE_CHANGED_" + str(relative))
    ensure(sum(file.is_file() for file in temporary.rglob("*")) == before_count + 2,
           "RELEASE_FILE_COUNT_UNEXPECTED")
    for name in ASSETS:
        ensure(digest(STAGE / name) == digest(temporary / "assets/share-link" / name),
               "JPG_DID_NOT_COPY_" + name)
    temporary.rename(destination)

    backup_path = STAGE / ("previous-release-" + revision + ".txt")
    backup_path.write_text(str(existing))
    backup_path.chmod(0o600)
    switched = False
    try:
        OVERLAY.write_text(original_overlay.replace(str(existing), str(destination), 1))
        switched = True
        command(COMPOSE + ["config", "--quiet"], timeout=55)
        command(COMPOSE + ["up", "-d", "--no-deps", "caddy"], timeout=175)
        cid = command(COMPOSE + ["ps", "-q", "caddy"], timeout=25).strip()
        ensure(bool(cid), "CADDY_CONTAINER_DOWN")
        index_live = command(DOCKER + ["exec", cid, "cat", "/srv/neis-circle/index.html"], timeout=28)
        circles_live = command(DOCKER + ["exec", cid, "cat", "/srv/neis-circle/circles.html"], timeout=28)
        ensure(OG_ROOT in index_live and OG_CIRCLES in circles_live, "SOCIAL_META_NOT_LIVE")
        ensure("window.location.replace('/#/circles');" in circles_live, "CIRCLES_REDIRECT_CHANGED")
        for name in ASSETS:
            actual = command(
                DOCKER + ["exec", cid, "sha256sum", "/srv/neis-circle/assets/share-link/" + name],
                timeout=25
            ).split()[0]
            ensure(actual == digest(STAGE / name), "LIVE_JPEG_HASH_MISMATCH_" + name)
        actual_caddy = command(DOCKER + ["exec", cid, "cat", "/etc/caddy/Caddyfile"], timeout=25)
        ensure(actual_caddy == caddy_source, "CADDY_CONFIG_CHANGED")
    except Exception:
        if switched:
            OVERLAY.write_text(original_overlay)
            try:
                command(COMPOSE + ["up", "-d", "--no-deps", "caddy"], timeout=175)
            except Exception:
                print("ORIGINAL_RATIO_OG_ROLLBACK=UNVERIFIED")
            else:
                print("ORIGINAL_RATIO_OG_ROLLBACK=COMPLETE")
        raise
    print("ORIGINAL_RATIO_OG_IMAGES=DEPLOYED_VERIFIED")
    print("ROOT_OG=THREE_BOYS")
    print("CIRCLES_OG=TWO_GIRLS")
    print("BOTH_OG_IMAGES=1491x1055")
    print("ORIGINAL_APP_AND_HOME_CONTENT=UNCHANGED")
    print("OTHER_SECTION_OG_IMAGES=UNCHANGED")
    print("CADDY_AND_STUDENT_DATA=UNCHANGED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("ORIGINAL_RATIO_OG_IMAGES=FAILED_" + str(error)[:240], file=sys.stderr)
        sys.exit(1)
