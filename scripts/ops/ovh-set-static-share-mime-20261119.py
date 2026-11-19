#!/usr/bin/env python3
"""Set HTML MIME on six extensionless section share files; no other Caddy changes."""
from pathlib import Path
import json,re,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-files-20261119')
BACKUP=STAGE/'Caddyfile-before-static-share-mime.backup'
MARKER='@neisShareHTML path /articles /study /circles /opportunities /gallery /timetable'
HEADER='header @neisShareHTML Content-Type "text/html; charset=utf-8"'
def need(v,msg):
 if not v:raise RuntimeError(msg)
def run(cmd,timeout=55):
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError('COMMAND_FAILED_'+(r.stderr or '')[-200:])
 return r.stdout
def main():
 m=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=26))[0].get('Mounts',[])
 conf=[Path(x['Source'])/'Caddyfile' for x in m if x.get('Destination')=='/etc/caddy']
 release=[Path(x['Source']) for x in m if x.get('Destination')=='/srv/neis-circle']
 need(len(conf)==len(release)==1,'CADDY_MOUNT_UNKNOWN')
 need('section-sharing-files-' in release[0].name,'CLEAN_SECTION_SHARE_RELEASE_NOT_ACTIVE')
 for slug in ('articles','study','circles','opportunities','gallery','timetable'):
  need((release[0]/slug).is_file(),'CLEAN_SHARE_FILE_MISSING_'+slug)
 old=conf[0].read_text()
 need(MARKER not in old and HEADER not in old,'CONTENT_TYPE_RULE_ALREADY_EXISTS')
 pattern=re.compile(r'(?m)^(neiscircle\.site, www\.neiscircle\.site \{\n\s*root \* /srv/neis-circle\n)')
 matches=list(pattern.finditer(old))
 need(len(matches)==1,'FRONTEND_CADDY_SITE_NOT_FOUND')
 anchor=matches[0]
 insertion=('  '+MARKER+'\n  '+HEADER+'\n')
 new=old[:anchor.end()]+insertion+old[anchor.end():]
 need(new.replace(insertion,'',1)==old,'ONLY_MIME_RULE_ALLOWED')
 need(not BACKUP.exists(),'BACKUP_ALREADY_EXISTS')
 STAGE.mkdir(parents=True,exist_ok=True)
 BACKUP.write_text(old);BACKUP.chmod(0o600)
 try:
  conf[0].write_text(new)
  run(DOCKER+['exec','supabase-caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],timeout=40)
  run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
 except Exception:
  conf[0].write_text(old)
  try:run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
  except Exception:print('SHARE_MIME_CONFIG_ROLLBACK=UNVERIFIED')
  else:print('SHARE_MIME_CONFIG_ROLLBACK=COMPLETE')
  raise
 print('STATIC_SECTION_HTML_MIME=SET')
 print('EXISTING_AUTH_AND_OTHER_ROUTES=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('STATIC_SECTION_HTML_MIME=FAILED_'+str(e)[:190],file=sys.stderr)
  sys.exit(1)
