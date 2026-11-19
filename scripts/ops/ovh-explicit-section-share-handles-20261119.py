#!/usr/bin/env python3
"""Caddy share page matcher: exact paths only, separate from the original SPA fallback."""
from pathlib import Path
import json,re,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-20261119')
BACKUP=STAGE/'Caddyfile-before-section-explicit-handles.backup'
def require(v,msg):
 if not v:raise RuntimeError(msg)
def run(cmd,timeout=55):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-250:])
 return p.stdout
def main():
 mounts=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0].get('Mounts',[])
 conf=[Path(x['Source'])/'Caddyfile' for x in mounts if x.get('Destination')=='/etc/caddy']
 require(len(conf)==1 and conf[0].is_file(),'CADDY_CONFIG_MISSING')
 source=[Path(x['Source']) for x in mounts if x.get('Destination')=='/srv/neis-circle']
 require(len(source)==1 and source[0].is_dir(),'FRONTEND_MOUNT_MISSING')
 for slug in ('articles','study','circles','opportunities','gallery','timetable'):
  page=source[0]/slug/'index.html'
  require(page.is_file() and 'og:title' in page.read_text(),'SHARE_PAGE_UNAVAILABLE_'+slug)
 config=conf[0].read_text()
 expected=re.compile(
  r'(?m)^(neiscircle\.site, www\.neiscircle\.site \{\n)'
  r'(\s*root \* /srv/neis-circle\n)'
  r'(\s*try_files \{path\} /index\.html\n)'
  r'(\s*file_server\n)')
 matches=list(expected.finditer(config))
 require(len(matches)==1,'EXPECTED_FRONTEND_CADDY_BLOCK_NOT_FOUND')
 match=matches[0]
 replacement=(match.group(1)+match.group(2)+
  '  @neisShareSection path_regexp neisShareSection ^/(articles|study|circles|opportunities|gallery|timetable)/?$\n'
  '  handle @neisShareSection {\n'
  '    rewrite * /{re.neisShareSection.1}/index.html\n'
  '    file_server\n'
  '  }\n'
  '  handle {\n'
  '    try_files {path} /index.html\n'
  '    file_server\n'
  '  }\n')
 target=config[:match.start()]+replacement+config[match.end():]
 require(target!=config and config[:match.start()]==target[:match.start()],'SCOPE_INVALID')
 require(not BACKUP.exists(),'SECONDARY_CADDY_BACKUP_EXISTS')
 STAGE.mkdir(parents=True,exist_ok=True)
 BACKUP.write_text(config);BACKUP.chmod(0o600)
 try:
  conf[0].write_text(target)
  run(DOCKER+['exec','supabase-caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],timeout=40)
  run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
 except Exception:
  conf[0].write_text(config)
  try:run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=45)
  except Exception:print('EXPLICIT_SHARE_CADDY_ROLLBACK=UNVERIFIED')
  else:print('EXPLICIT_SHARE_CADDY_ROLLBACK=COMPLETE')
  raise
 print('EXPLICIT_PUBLIC_SHARE_HANDLES=ACTIVE')
 print('ORIGINAL_SPA_FALLBACK=RETAINED')
 print('AUTH_API_CONFIG=UNTOUCHED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('EXPLICIT_PUBLIC_SHARE_HANDLES=FAILED_'+str(e)[:200],file=sys.stderr)
  sys.exit(1)
