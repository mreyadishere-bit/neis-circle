#!/usr/bin/env python3
"""Build OG previews for CLEAN URLs that instantly open original /#/ routes.

These are metadata-only documents, never a new app/page design. A normal
browser runs the immediate JS location.replace; social preview crawlers that
do not run JS read distinct OpenGraph images and text.

Existing approved images were incorrectly resized to 1200x630. Reverse their
aspect distortion, then letterbox (no crop) on the required 1200x630 social
canvas. This script never alters the original artwork or the existing app.
"""
from pathlib import Path
from PIL import Image
from html import escape
import argparse, json, math

SITE = "https://neiscircle.site"
# Actual dimensions of the user-supplied artwork BEFORE the earlier stretched resize.
ARTWORK = {
    "feed": (1672, 941, "Feed", "Student posts, discussions, and experiences."),
    "discover": (1672, 941, "Discover", "Explore people, student projects, and interests."),
    "study": (1672, 941, "Study", "Learning materials and study resources for students."),
    "messages": (1672, 941, "Messages", "Conversations and connections between students."),
    "connections": (1672, 941, "Connections", "Discover students who share your interests."),
    "saved": (1672, 941, "Saved", "Keep your favorite student resources and ideas close."),
    "opportunities": (1672, 941, "Opportunities", "Student competitions, educational opportunities, and activities."),
    "gallery": (1672, 941, "Gallery", "Creative work and visual projects shared by students."),
    "articles": (1672, 941, "Articles", "Explore articles, ideas, and perspectives by students."),
    "circles": (1672, 941, "Circles", "Student communities built around shared interests."),
    "analytics": (1254, 1254, "Analytics", "Explore NEIS Circle analytics and tools."),
    "timetable": (1491, 1055, "Timetable", "Stay organized with your student timetable."),
    "notifications": (1491, 1055, "Notifications", "Stay updated with your student community."),
    "settings": (1491, 1055, "Settings", "Configure your NEIS Circle experience."),
    "games": (1491, 1055, "Games", "Explore interactive student games and challenges."),
}

def build_image(source, target, width, height):
    with Image.open(source) as original:
        if original.format != "WEBP" or original.size != (1200, 630):
            raise ValueError(f"Unexpected image source: {source} {original.size}")
        # Restore proportions by reversing the former non-proportional resize.
        correct_width = round(630 * width / height)
        if correct_width > 1200:
            raise ValueError("Unsafe width: " + str(correct_width))
        resized = original.convert("RGB").resize((correct_width, 630), Image.Resampling.LANCZOS)
        # The supplied artwork has near-white backgrounds; no content is cut.
        background = Image.new("RGB", (1200, 630), (255, 255, 255))
        background.paste(resized, ((1200 - correct_width) // 2, 0))
        target.parent.mkdir(parents=True, exist_ok=True)
        background.save(target, "WEBP", quality=93, method=6)
    with Image.open(target) as check:
        assert check.size == (1200, 630)
        assert check.format == "WEBP"
    return correct_width

def build_html(slug, title, description, target):
    share_url = SITE + "/" + slug
    image_url = SITE + "/assets/share-link/" + slug + ".webp?v=20261119-proportions"
    page_title = title + " | NEIS Circle"
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(page_title)}</title>
<meta name="description" content="{escape(description,quote=True)}">
<meta name="robots" content="noindex,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NEIS Circle">
<meta property="og:url" content="{share_url}">
<meta property="og:title" content="{escape(page_title,quote=True)}">
<meta property="og:description" content="{escape(description,quote=True)}">
<meta property="og:image" content="{image_url}">
<meta property="og:image:secure_url" content="{image_url}">
<meta property="og:image:type" content="image/webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{escape('NEIS Circle '+title,quote=True)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(page_title,quote=True)}">
<meta name="twitter:description" content="{escape(description,quote=True)}">
<meta name="twitter:image" content="{image_url}">
<link rel="canonical" href="{share_url}">
<script>
/* Open the ORIGINAL NEIS Circle route immediately; no separate UI is rendered. */
window.location.replace('/'+window.location.search+'#/{slug}');
</script>
</head>
<body><noscript><a href="/#/{slug}">Open {escape(title)} in NEIS Circle</a></noscript></body>
</html>
"""
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(html,encoding="utf-8")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--assets-dir",required=True)
    parser.add_argument("--output-dir",required=True)
    args=parser.parse_args()
    incoming=Path(args.assets_dir)
    out=Path(args.output_dir)
    summary={}
    for slug,(w,h,title,description) in ARTWORK.items():
        source=incoming/(slug+".webp")
        if not source.is_file():
            raise FileNotFoundError(str(source))
        dest=out/"assets/share-link"/(slug+".webp")
        corrected=build_image(source,dest,w,h)
        build_html(slug,title,description,out/"html"/(slug+".html"))
        summary[slug]={"url":SITE+"/"+slug,
                       "app_url":SITE+"/#/"+slug,
                       "og_image":SITE+"/assets/share-link/"+slug+".webp?v=20261119-proportions",
                       "original_dimensions":[w,h],
                       "corrected_artwork_width":corrected}
    (out/"mapping.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    assert len(list((out/"html").glob("*.html")))==15
    print("CLEAN_HASH_SHARE_METADATA=15_PAGES")
    print("ORIGINAL_ARTWORK_ASPECT_RATIOS=RESTORED_WITHOUT_CROPPING")
    print("MAIN_APP_AND_HOME_ARTWORK=NOT_MODIFIED")

if __name__=="__main__":main()
