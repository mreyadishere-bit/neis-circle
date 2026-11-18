#!/usr/bin/env python3
"""SEO-only OVH frontend release, preserving the entire active application."""
from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/seo-foundation-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[x for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for x in ('-f',f)]
MARKER='20261119-seo-v1'
DESC='NEIS Circle is a bilingual student community to connect with students, share projects and articles, and discover educational opportunities.'
TITLE='NEIS Circle | Student Community, Projects & Opportunities'
ABOUT_LINK='<p class="auth-note"><a href="/about.html" rel="help">'
def require(ok,why):
 if not ok:raise RuntimeError(why)
def run(cmd,timeout=90):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+str(p.returncode)+':'+(p.stderr or '')[-180:])
 return p.stdout
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def change_meta(html,pattern,replace):
 updated,n=re.subn(pattern,lambda m:replace,html,count=1,flags=re.I)
 require(n==1,'META_MISSING_'+pattern[:32])
 return updated
def main():
 require(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_MISSING')
 for n in ('about.html','sitemap.xml','robots.txt','index.html','03-auth-i18n.js'):
  require((STAGE/n).is_file(),'MISSING_STAGE_'+n)
 about=(STAGE/'about.html').read_text()
 sitemap=(STAGE/'sitemap.xml').read_text()
 robots=(STAGE/'robots.txt').read_text()
 staged_auth=(STAGE/'03-auth-i18n.js').read_text()
 require('About NEIS Circle' in about and '<html lang="en">' in about and
         'index,follow' in about,'ABOUT_INVALID')
 require('https://neiscircle.site/about.html' in sitemap and
         'https://neiscircle.site/' in sitemap and
         '<url>' in sitemap and 'profile/' not in sitemap,'SITEMAP_INVALID')
 require('Sitemap: https://neiscircle.site/sitemap.xml' in robots,'ROBOTS_INVALID')
 require(ABOUT_LINK in staged_auth and 'data-auth-google' in staged_auth,'AUTH_LINK_INVALID')
 run(['node','--check',str(STAGE/'03-auth-i18n.js')],timeout=18)
 run(COMPOSE+['config','--quiet'],timeout=50)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Type')=='bind' and m.get('Destination')=='/srv/neis-circle']
 require(len(mounts)==1,'CADDY_FRONTEND_BIND_MISSING')
 old=Path(mounts[0])
 require(old.parent==RELEASES and old.is_dir(),'UNEXPECTED_FRONTEND_RELEASE')
 original=OVERLAY.read_text()
 require(original.count(str(old))==1,'OVERLAY_CHANGED')
 src_index=(old/'index.html').read_text()
 src_auth=(old/'scripts/03-auth-i18n.js').read_text()
 require(src_index.count('</head>')==1 and
         src_index.count('scripts/03-auth-i18n.js')==1 and
         src_index.count('scripts/user-activity-v1.js')==1 and
         'last-active-ui-v2' in src_index,'ACTIVE_VERSION_UNEXPECTED')
 require(src_auth.count('function authScreen()')==1 and
         src_auth.count('data-auth-google')>=1,'AUTH_SOURCE_UNEXPECTED')
 require(ABOUT_LINK not in src_auth and
         'about.html' not in src_index,'SEO_ALREADY_DEPLOYED')
 count=sum(f.is_file() for f in old.rglob('*'))
 require(count>100,'INCOMPLETE_LIVE_FRONTEND')
 rev=os.environ.get('GITHUB_SHA','')[:12]
 require(bool(re.fullmatch('[0-9a-f]{12}',rev)),'INVALID_REVISION')
 target=RELEASES/('seo-foundation-'+rev)
 tmp=Path(str(target)+'.building')
 require(not target.exists() and not tmp.exists(),'RELEASE_EXISTS')
 shutil.copytree(old,tmp)
 for name in ('about.html','sitemap.xml','robots.txt'):
  shutil.copy2(STAGE/name,tmp/name)
 html=src_index
 html=change_meta(html,r'<title>[^<]*</title>','<title>'+TITLE+'</title>')
 html=change_meta(html,r'<meta\\s+name="description"\\s+content="[^"]*"\\s*/?>',
                  '<meta name="description" content="'+DESC+'">')
 for prop in ('og:title','twitter:title'):
  html=change_meta(html,r'<meta\\s+(?:property|name)="'+prop+r'"\\s+content="[^"]*"\\s*/?>',
                   '<meta '+('property' if prop.startswith('og:') else 'name')+'="'+prop+'" content="'+TITLE+'">')
 for prop in ('og:description','twitter:description'):
  html=change_meta(html,r'<meta\\s+(?:property|name)="'+prop+r'"\\s+content="[^"]*"\\s*/?>',
                   '<meta '+('property' if prop.startswith('og:') else 'name')+'="'+prop+'" content="'+DESC+'">')
 schema='<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"NEIS Circle","alternateName":"NEIS Circle Student Community","url":"https://neiscircle.site/","description":"A bilingual student community for sharing ideas, learning projects and opportunities.","inLanguage":["en","ar"]}</script>'
 require(schema in (STAGE/'index.html').read_text(),'STAGED_SCHEMA_INVALID')
 html=html.replace('</head>','  <meta property="og:site_name" content="NEIS Circle">\\n  '+schema+'\\n</head>',1)
 html,n=re.subn(r'(scripts/03-auth-i18n\\.js)(?:\\?[^"\\s]*)?',lambda m:m.group(1)+'?v='+MARKER,html,count=1)
 require(n==1,'AUTH_CACHE_BUST_FAILED')
 (tmp/'index.html').write_text(html)
 note_start='<p class="auth-note">${bi(\'Google is used only for secure authentication. Your profile is completed in the next step.\',\'يُستخدم Google لتسجيل الدخول الآمن فقط، ثم تكمل ملفك في الخطوة التالية.\')}</p>'
 require(src_auth.count(note_start)==1,'AUTH_NOTE_UNEXPECTED')
 new_link=ABOUT_LINK+'${bi(\'About NEIS Circle · What you can do\',\'عن NEIS Circle · تعرّف على المنصة\')}</a></p>'
 require(new_link in staged_auth,'STAGED_AUTH_LINK_MISMATCH')
 auth=src_auth.replace(note_start,note_start+new_link,1)
 (tmp/'scripts/03-auth-i18n.js').write_text(auth)
 require(sum(f.is_file() for f in tmp.rglob('*'))==count+1,'RELEASE_COPY_COUNT_MISMATCH')
 require(digest((tmp/'scripts/user-activity-v1.js').read_text())==
         digest((old/'scripts/user-activity-v1.js').read_text()),'ACTIVITY_ASSET_CHANGED')
 require('scripts/user-activity-v1.js' in html and
         'last-active-ui-v2' in html and
         'function onboardingScreen()' in auth,'APPLICATION_PRESERVATION_FAILED')
 tmp.rename(target)
 changed=False
 try:
  OVERLAY.write_text(original.replace(str(old),str(target),1));changed=True
  run(COMPOSE+['config','--quiet'],timeout=55)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  require(bool(cid),'CADDY_NOT_RUNNING')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  live_auth=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/scripts/03-auth-i18n.js'],timeout=25)
  require(digest(live)==digest(html) and digest(live_auth)==digest(auth),'LIVE_ASSET_MISMATCH')
  for file in ('about.html','sitemap.xml','robots.txt'):
   actual=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/'+file],timeout=25)
   require(digest(actual)==digest((STAGE/file).read_text()),'LIVE_FILE_MISMATCH_'+file)
  conf=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  require(all(x in conf for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),
    'AUTH_PROXY_CHANGED')
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=135)
   except Exception:print('SEO_FRONTEND_ROLLBACK=UNVERIFIED')
   else:print('SEO_FRONTEND_ROLLBACK=COMPLETE')
  raise
 print('SEO_FOUNDATION_OVH=DEPLOYED_VERIFIED')
 print('APP_AUTH_AND_LAST_ACTIVE=RETAINED')
 print('STUDENT_DATA=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('SEO_FOUNDATION_OVH=FAILED_'+str(exc)[:190],file=sys.stderr)
  sys.exit(1)
