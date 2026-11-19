#!/usr/bin/env python3
"""Generate static, crawler-readable NEIS Circle section share previews.

Each section has its own stable, canonical URL and metadata. Until the owner
provides approved artwork, the existing brand poster is used as a placeholder.
Replace the image URL in SECTIONS after assets/share/<section>.webp are uploaded.
No private posts, profiles, messages, or account details are published.
"""
from pathlib import Path
import argparse, html, json, re
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent

BASE="https://neiscircle.site"
FALLBACK_IMAGE="/assets/referral-poster.webp?v=49.4"
# slug: (title, short description, public intro, Arabic intro, illustration URL)
SECTIONS={
 "articles":(
  "Articles","Discover student-written articles, thoughtful perspectives and ideas shared in NEIS Circle.",
  "Read student-written articles, explore perspectives, and discover ideas from a community built by students.",
  "اكتشف مقالات الطلاب وأفكارهم وتجاربهم في مجتمع NEIS Circle.",
  FALLBACK_IMAGE),
 "study":(
  "Study","Explore study resources, learning tools and useful materials shared in the NEIS Circle student community.",
  "Find a dedicated space for educational resources, useful study materials, and collaborative learning.",
  "مساحة للموارد الدراسية والأدوات التعليمية وتبادل المعرفة بين الطلاب.",
  FALLBACK_IMAGE),
 "circles":(
  "Circles","Connect with fellow students in NEIS Circle communities centered on shared interests and ideas.",
  "Join focused student communities, exchange ideas, and connect with people who share your interests.",
  "انضم إلى مجتمعات الطلاب التي تجمع الاهتمامات والأفكار المشتركة.",
  FALLBACK_IMAGE),
 "opportunities":(
  "Opportunities","Discover student-focused learning opportunities, competitions, activities and events on NEIS Circle.",
  "Explore opportunities worth discovering, from competitions and events to useful learning activities.",
  "استكشف الفرص التعليمية والمسابقات والأنشطة والفعاليات المناسبة للطلاب.",
  FALLBACK_IMAGE),
 "gallery":(
  "Gallery","Explore creative student work and shared visual projects in the NEIS Circle gallery.",
  "A dedicated space for creativity, visual projects, and student contributions.",
  "مساحة للأعمال الإبداعية والمشروعات البصرية التي يشاركها الطلاب.",
  FALLBACK_IMAGE),
 "timetable":(
  "Timetable","Organize school study schedules and timetable information with NEIS Circle's student tools.",
  "Stay organized with student-focused timetable and planning tools.",
  "نظم جدولك الدراسي باستخدام أدوات NEIS Circle للطلاب.",
  FALLBACK_IMAGE)
}
CSS="""*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#112820;background:linear-gradient(135deg,#f8faf7,#eef6f2 65%,#e5f3eb);line-height:1.65}a{color:#006f57}a:focus-visible{outline:3px solid #008566;outline-offset:4px}.shell{width:min(1060px,calc(100% - 40px));margin:auto}.nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:25px 0}.brand{display:flex;align-items:center;gap:13px;text-decoration:none;color:#122b23;font-weight:750}.mark{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;background:#08765d;color:#fff;font-weight:800}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.13em;color:#008067;text-transform:uppercase}.hero{margin:44px 0 36px;background:#fff;border-radius:30px;border:1px solid #dae9df;padding:clamp(28px,5vw,65px);box-shadow:0 20px 60px #173b2810}.hero h1{font-size:clamp(2.8rem,8vw,5.8rem);line-height:1.05;letter-spacing:-.06em;margin:15px 0 22px}.lead{color:#47645b;font-size:clamp(1.05rem,2.2vw,1.3rem);max-width:730px}.actions{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin:31px 0 0}.button{display:inline-flex;padding:13px 24px;background:#08765d;border-radius:13px;color:white;text-decoration:none;font-weight:700}.button:hover{background:#005d48}.muted{color:#5a7067}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:24px 0 46px}.tile{display:block;padding:17px 20px;border-radius:16px;border:1px solid #d5e8df;background:#ffffffbc;text-decoration:none;color:#24453c;font-weight:650}.tile.active{background:#dff3e9;border-color:#98d8bb}.notice{padding:23px 27px;border-radius:20px;background:#e3f1ea}.rtl{direction:rtl;text-align:right}footer{border-top:1px solid #c9dfd4;display:flex;flex-wrap:wrap;justify-content:space-between;gap:15px;padding:23px 0 35px;color:#5a7067;font-size:13px}@media(max-width:670px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{margin:18px 0}.nav{padding:18px 0}}"""
def tag(title,text):
 return '<meta name="'+html.escape(title,quote=True)+'" content="'+html.escape(text,quote=True)+'">'
def build(slug, out):
 title,description,intro,arabic,image=SECTIONS[slug]
 canonical=f"{BASE}/{slug}"
 picture=image if image.startswith("https://") else BASE+image
 page_title=f"{title} | NEIS Circle – Student Community"
 nav_tiles="".join(f'<a class="tile{" active" if s==slug else ""}" href="/{s}">{html.escape(v[0])}</a>'
                   for s,v in SECTIONS.items())
 structure={
  "@context":"https://schema.org","@type":"WebPage","name":page_title,
  "url":canonical,"description":description,"inLanguage":["en","ar"],
  "isPartOf":{"@type":"WebSite","name":"NEIS Circle","url":BASE+"/"}
 }
 schema_json=json.dumps(structure,ensure_ascii=False,separators=(',',':'))
 markup=f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(page_title)}</title>
{tag("description",description)}
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{canonical}">
<link rel="icon" href="/assets/email-logo.png?v=original-tab-20261119" type="image/png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NEIS Circle">
<meta property="og:url" content="{canonical}">
<meta property="og:title" content="{html.escape(page_title,quote=True)}">
<meta property="og:description" content="{html.escape(description,quote=True)}">
<meta property="og:image" content="{html.escape(picture,quote=True)}">
<meta property="og:image:alt" content="{html.escape('NEIS Circle '+title+' community preview',quote=True)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(page_title,quote=True)}">
<meta name="twitter:description" content="{html.escape(description,quote=True)}">
<meta name="twitter:image" content="{html.escape(picture,quote=True)}">
<script type="application/ld+json">{schema_json}</script>
<style>{CSS}</style>
</head>
<body>
<div class="shell">
<header class="nav"><a href="/" class="brand"><span class="mark" aria-hidden="true">NC</span><span>NEIS Circle</span></a><a href="/about.html">About the community</a></header>
<main>
<section class="hero">
<span class="eyebrow">An independent community for students</span>
<h1>{html.escape(title)}</h1>
<p class="lead">{html.escape(intro)}</p>
<p class="muted">Explore this section inside NEIS Circle. Some community features require a member account.</p>
<div class="actions">
<a class="button" href="/#/{slug}">Open {html.escape(title)} in NEIS Circle</a>
<a href="/">NEIS Circle home</a>
</div>
</section>
<section class="rtl notice" lang="ar" aria-label="بالعربية"><p>{html.escape(arabic)}</p><a href="/#/{slug}">افتح القسم داخل NEIS Circle</a></section>
<section aria-label="Explore more NEIS Circle sections"><h2>Explore other sections</h2><div class="grid">{nav_tiles}</div></section>
</main>
<footer><span>NEIS Circle · Independent student community</span><span>Not an official school website · Private student content is not indexed here</span></footer>
</div>
</body>
</html>
"""
 target=out/slug
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_text(markup,encoding="utf-8")
 return canonical
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--output-dir',required=True)
 args=parser.parse_args()
 out=Path(args.output_dir)
 urls=[BASE+"/",BASE+"/about.html"]
 for slug in SECTIONS:
  urls.append(build(slug,out))
 root=Element("urlset",{"xmlns":"http://www.sitemaps.org/schemas/sitemap/0.9"})
 for url in urls:
  node=SubElement(root,"url")
  SubElement(node,"loc").text=url
 indent(root)
 ElementTree(root).write(out/"sitemap.xml",encoding="utf-8",xml_declaration=True)
 assert sum((out/slug).is_file() for slug in SECTIONS)==len(SECTIONS)
 print("PUBLIC_SECTION_SHARE_PAGES=GENERATED")
 print("SITEMAP_URL_COUNT="+str(len(urls)))
 print("PRIVATE_CONTENT_EXCLUDED=YES")
if __name__=="__main__":main()
