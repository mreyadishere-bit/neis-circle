#!/usr/bin/env python3
"""Allow static NEIS Circle share pages to resolve before the existing SPA fallback.

Changes one line inside the frontend Caddy site only. API/Auth routes and all
other Caddy site blocks stay byte-identical; rollback file stays on OVH.
"""
from pathlib import Path
import hashlib,json,re,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-20261119')
OLD='try_files {path} /index.html'
NEW='try_files {path} {path}/index.html /index.html'
def fail(msg):raise RuntimeError(msg)
def run(cmd,timeout=65):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:fail('COMMAND_FAILED_'+(p.stderr or '')[-180:])
 return p.stdout
def main():
 info=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 mounts=[Path(m['Source']) for m in info.get('Mounts',[]) if m.get('Destination')=='/etc/caddy']
 if len(mounts)!=1:fail('CADDY_CONFIG_MOUNT_UNKNOWN')
 path=mounts[0]/'Caddyfile'
 if not path.is_file():fail('CADDYFILE_MISSING')
 config=path.read_text()
 if config.count(OLD)!=1:fail('SPA_FALLBACK_PATTERN_CHANGED')
 pattern=r'(neiscircle\.site, www\.neiscircle\.site \{\s*root \* /srv/neis-circle\s*)'+re.escape(OLD)
 match=re.search(pattern,config)
 if not match:fail('FRONTEND_SITE_NOT_EXACT_MATCH')
 target=config[:match.start()]+match.group(1)+NEW+config[match.end():]
 if target.replace(NEW,OLD,1)!=config:fail('CONFIG_SCOPE_CHECK_FAILED')
 if not all(s in config for s in ('reverse_proxy rest:3000','reverse_proxy auth:9999','basic_auth')):
  fail('PROTECTED_ROUTES_MISSING')
 files=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0]
 source=[Path(m['Source']) for m in files.get('Mounts',[]) if m.get('Destination')=='/srv/neis-circle']
 if len(source)!=1:fail('FRONTEND_SOURCE_UNKNOWN')
 for section in ('articles','study','circles','opportunities','gallery','timetable'):
  page=source[0]/section/'index.html'
  if not page.is_file() or 'property="og:title"' not in page.read_text():fail('SHARE_SECTION_MISSING_'+section)
 if 'section-share-router-v1.js' not in (source[0]/'index.html').read_text():
  fail('SHARE_ROUTER_NOT_ACTIVE')
 backup=STAGE/'Caddyfile-before-section-sharing.backup'
 if backup.exists():fail('BACKUP_ALREADY_EXISTS')
 STAGE.mkdir(parents=True,exist_ok=True)
 backup.write_text(config);backup.chmod(0o600)
 try:
  path.write_text(target)
  run(DOCKER+['exec','supabase-caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],timeout=40)
  run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
 except Exception:
  path.write_text(config)
  try:run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
  except Exception:print('SHARE_ROUTE_CONFIG_ROLLBACK=UNVERIFIED')
  else:print('SHARE_ROUTE_CONFIG_ROLLBACK=COMPLETE')
  raise
 print('CADDY_STATIC_SECTION_ROUTING=ACTIVE')
 print('AUTH_AND_API_ROUTES=BYTE_IDENTICAL')
 print('FRONTEND_CONTENT=UNCHANGED')
 print('ROLLBACK_BACKUP=SECURED_ON_OVH')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('CADDY_SHARE_ROUTE=FAILED_'+str(e)[:190],file=sys.stderr)
  sys.exit(1)
