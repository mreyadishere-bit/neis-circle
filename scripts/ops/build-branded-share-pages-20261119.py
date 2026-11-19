#!/usr/bin/env python3
"""Build NEIS Circle's branded public sharing pages from approved uploaded artwork.

This extends the existing sharing page generator without replacing its visual
templates or application navigation. Public-only metadata; never student data.
"""
from pathlib import Path
import argparse,json,runpy
from xml.etree.ElementTree import Element,SubElement,ElementTree,indent

BASE="https://neiscircle.site"
IMAGES=("feed","discover","study","messages","connections","saved",
        "opportunities","gallery","articles","circles","analytics",
        "timetable","notifications","settings","games")
ADDITIONAL={
 "feed":("Feed","Discover student posts and conversations on NEIS Circle.",
  "Explore student discussions, shared experiences and helpful ideas.",
  "اكتشف منشورات الطلاب ومناقشاتهم وتجاربهم."),
 "discover":("Discover","Find students, projects and interesting ideas in NEIS Circle.",
  "Explore people, student projects and learning interests.",
  "اكتشف الطلاب والمشروعات والاهتمامات المشتركة."),
 "messages":("Messages","Connect with fellow students through NEIS Circle messaging.",
  "A place for student conversations and staying connected with peers.",
  "تواصل مع الطلاب من خلال محادثات NEIS Circle."),
 "connections":("Connections","Build student connections and discover shared interests.",
  "Find and connect with students who share your curiosity and goals.",
  "كوّن علاقات مع الطلاب أصحاب الاهتمامات المشتركة."),
 "saved":("Saved","Keep useful student articles and resources organized in NEIS Circle.",
  "Return to the helpful content and resources you choose to save.",
  "احتفظ بالمقالات والموارد المفيدة للعودة إليها لاحقًا."),
 "analytics":("Analytics","Explore personal progress and useful activity insights in NEIS Circle.",
  "Understand progress using student-friendly insights and visual summaries.",
  "تابع تقدمك واطّلع على إحصاءات وأنشطة مفيدة."),
 "timetable":("Timetable","Organize class schedules and study time with the NEIS Circle timetable.",
  "Plan lessons and organize your week with student timetable tools.",
  "نظّم حصصك ومواعيدك باستخدام الجدول الدراسي."),
 "notifications":("Notifications","Stay informed about updates and important activity in NEIS Circle.",
  "Find helpful updates and notifications from your student community.",
  "تابع الإشعارات والتحديثات المهمة من مجتمع الطلاب."),
 "settings":("Settings","Customize the NEIS Circle student experience and manage your preferences.",
  "Adjust appearance and preferences to make your NEIS Circle experience yours.",
  "خصص إعدادات وتجربة استخدام NEIS Circle."),
 "games":("Games","Discover interactive student games and challenges in NEIS Circle.",
  "Explore fun learning challenges and interactive student activities.",
  "استكشف الألعاب والتحديات التفاعلية للطلاب.")
}
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--output-dir',required=True)
 p.add_argument('--assets-dir',required=True)
 args=p.parse_args()
 out=Path(args.output_dir)
 source=Path(args.assets_dir)
 for slug in IMAGES:
  path=source/(slug+'.webp')
  if not path.is_file() or path.stat().st_size<2000:
   raise RuntimeError("Required approved illustration missing: "+str(path))
 main_image=source/'home-main.webp'
 if not main_image.is_file():raise RuntimeError("Main illustration missing")
 base=Path(__file__).resolve().parent
 original=runpy.run_path(str(base/'build-section-share-pages-20261119.py'))
 sections=original['build'].__globals__['SECTIONS']
 for slug,(title,description,intro,arabic) in ADDITIONAL.items():
  sections[slug]=(title,description,intro,arabic,'/assets/share/'+slug+'.webp')
 for slug in IMAGES:
  section=sections[slug]
  sections[slug]=tuple(section[:4])+('/assets/share/'+slug+'.webp?v=20261119-art',)
 out.mkdir(parents=True,exist_ok=True)
 for slug in list(sections):
  original['build'](slug,out)
  # The base generator writes an extensionless file; the published, crawler-
  # verified canonical links are .html and require matching real files.
  source_file=out/slug
  target_file=out/(slug+'.html')
  if not source_file.is_file() or target_file.exists():
   raise RuntimeError('Unexpected generated share page: '+slug)
  source_file.rename(target_file)
 urls=[BASE+'/',BASE+'/about.html']+[BASE+'/'+slug+'.html' for slug in sections]
 root=Element('urlset',{'xmlns':'http://www.sitemaps.org/schemas/sitemap/0.9'})
 for url in urls:
  item=SubElement(root,'url')
  SubElement(item,'loc').text=url
 indent(root)
 ElementTree(root).write(out/'sitemap.xml',encoding='utf-8',xml_declaration=True)
 mapping={'homepage':BASE+'/','homepage_image':BASE+'/assets/share/home-main.webp?v=20261119-art',
          'app_home':'preserved, no change','sections':{
           k:{'url':BASE+'/'+k+'.html',
              'image':BASE+sections[k][4] if sections[k][4].startswith('/') else sections[k][4]}
           for k in sections}}
 (out/'mapping.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2),encoding='utf8')
 assert all((out/(slug+'.html')).is_file() for slug in sections)
 print("APPROVED_SHARE_PAGES="+str(len(sections)))
 print("MAIN_AND_HOME_IMAGE_POLICY=MAIN_UPDATED_HOME_PRESERVED")
if __name__=='__main__':main()
