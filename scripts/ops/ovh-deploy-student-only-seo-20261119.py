#!/usr/bin/env python3
"""Deploy only NEIS Circle identity clarification; keep all existing OVH features."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/seo-student-identity-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[a for n in ('docker-compose.yml','docker-compose.security.yml',
 'docker-compose.caddy.yml','docker-compose.frontend-public.yml',
 'docker-compose.auth-public-direct.yml') for a in ('-f',n)]
DESCRIPTION='NEIS Circle is an independent, student-built online community for students to connect, share projects, discuss ideas, and discover opportunities.'
SCHEMA='An independent, student-built community for students only. NEIS Circle is not an official school administration website.'
def must(test,code):
 if not test:raise RuntimeError(code)
def run(cmd,timeout=100):
 p=subprocess.run(cmd,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-200:])
 return p.stdout
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 must(STAGE.is_dir() and OVERLAY.is_file() and RELEASES.is_dir(),'STAGE_NOT_READY')
 index_source=(STAGE/'index.html').read_text()
 about=(STAGE/'about.html').read_text()
 must(DESCRIPTION in index_source and SCHEMA in index_source,'SOURCE_IDENTITY_MISSING')
 must('not the official website, LinkedIn account' in about and
      'not a platform for teachers or parents' in about,'PUBLIC_PAGE_CLARIFICATION_MISSING')
 run(COMPOSE+['config','--quiet'],timeout=55)
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]
 mounts=[m['Source'] for m in info.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle' and m.get('Type')=='bind']
 must(len(mounts)==1,'LIVE_FRONTEND_MOUNT_MISSING')
 current=Path(mounts[0]);overlay=OVERLAY.read_text()
 must(current.is_dir() and current.parent==RELEASES and overlay.count(str(current))==1,'LIVE_RELEASE_UNEXPECTED')
 oldhtml=(current/'index.html').read_text()
 must(oldhtml.count('<meta name="description"')==1 and
      'scripts/user-activity-v1.js' in oldhtml and
      '20261119-compact-theme-icon' in oldhtml and
      '20261119-mobile-install-only' in oldhtml and
      'original-tab-20261119' in oldhtml,'LIVE_FEATURES_UNEXPECTED')
 expected='NEIS Circle is a bilingual student community to connect with students, share projects and articles, and discover educational opportunities.'
 must(oldhtml.count(expected)==3,'OLD_DESCRIPTIONS_UNEXPECTED')
 oldschema='A bilingual student community for sharing ideas, learning projects and opportunities.'
 must(oldhtml.count(oldschema)==1,'OLD_SCHEMA_UNEXPECTED')
 count=sum(x.is_file() for x in current.rglob('*'))
 must(count>100,'SOURCE_RELEASE_INCOMPLETE')
 revision=os.environ.get('GITHUB_SHA','')[:12]
 must(bool(re.fullmatch('[0-9a-f]{12}',revision)),'BAD_COMMIT_SHA')
 dest=RELEASES/('seo-student-identity-'+revision)
 tmp=Path(str(dest)+'.building')
 must(not dest.exists() and not tmp.exists(),'RELEASE_ALREADY_EXISTS')
 shutil.copytree(current,tmp)
 newhtml=oldhtml.replace(expected,DESCRIPTION).replace(oldschema,SCHEMA)
 (tmp/'index.html').write_text(newhtml)
 shutil.copy2(STAGE/'about.html',tmp/'about.html')
 must(sum(x.is_file() for x in tmp.rglob('*'))==count,'FILE_COUNT_MISMATCH')
 for f in ('scripts/03-auth-i18n.js','scripts/user-activity-v1.js','scripts/pwa-install-v117.js',
           'styles/ui-v14.css','assets/email-logo.png','favicon.ico'):
  must(sha(tmp/f)==sha(current/f),'UNEXPECTED_ASSET_CHANGE_'+f)
 tmp.rename(dest)
 activated=False
 try:
  OVERLAY.write_text(overlay.replace(str(current),str(dest),1));activated=True
  run(COMPOSE+['config','--quiet'],timeout=50)
  run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=160)
  cid=run(COMPOSE+['ps','-q','caddy'],timeout=25).strip()
  must(bool(cid),'CADDY_DOWN')
  live=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/index.html'],timeout=25)
  liveabout=run(DOCKER+['exec',cid,'cat','/srv/neis-circle/about.html'],timeout=25)
  must(hashlib.sha256(live.encode()).hexdigest()==sha(dest/'index.html') and
       hashlib.sha256(liveabout.encode()).hexdigest()==sha(STAGE/'about.html'),'PUBLIC_CONTENT_NOT_UPDATED')
  caddy=run(DOCKER+['exec',cid,'cat','/etc/caddy/Caddyfile'],timeout=25)
  must(all(x in caddy for x in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')),'AUTH_ROUTING_CHANGED')
 except Exception:
  if activated:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=150)
   except Exception:print('STUDENT_IDENTITY_ROLLBACK=UNVERIFIED')
   else:print('STUDENT_IDENTITY_ROLLBACK=COMPLETE')
  raise
 print('STUDENT_ONLY_SEO_IDENTITY=DEPLOYED')
 print('LINKEDIN_ACCOUNT_ADDED=NO')
 print('AUTH_AND_STUDENT_RECORDS=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('STUDENT_ONLY_SEO_IDENTITY=FAILED_'+str(e)[:200],file=sys.stderr)
  sys.exit(1)
