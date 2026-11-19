#!/usr/bin/env python3
"""Map /articles to /articles.html using literal Caddy paths, preserving SPA Auth."""
from pathlib import Path
import json,re,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-html-20261119')
BACKUP=STAGE/'Caddyfile-before-literal-share-routes.backup'
SLUGS=('articles','study','circles','opportunities','gallery','timetable')
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def run(cmd,timeout=60):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-250:])
 return p.stdout
def main():
 mounts=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=25))[0].get('Mounts',[])
 configs=[Path(m['Source'])/'Caddyfile' for m in mounts if m.get('Destination')=='/etc/caddy']
 frontend=[Path(m['Source']) for m in mounts if m.get('Destination')=='/srv/neis-circle']
 require(len(configs)==len(frontend)==1,'MOUNT_MISSING')
 require('section-sharing-html-' in frontend[0].name,'HTML_SECTION_RELEASE_MISSING')
 for s in SLUGS:
  p=frontend[0]/(s+'.html')
  require(p.is_file() and 'property="og:title"' in p.read_text(),'HTML_SECTION_MISSING_'+s)
 config=configs[0].read_text()
 pattern=re.compile(r'(?m)^(neiscircle\.site, www\.neiscircle\.site \{\n)(\s*root \* /srv/neis-circle\n)(\s*try_files \{path\} /index\.html\n)(\s*file_server\n)')
 matches=list(pattern.finditer(config))
 require(len(matches)==1,'EXPECTED_SITE_BLOCK_NOT_FOUND')
 m=matches[0]
 handles=''.join(f'  handle /{slug} {{\n    rewrite * /{slug}.html\n    file_server\n  }}\n' for slug in SLUGS)
 replacement=(m.group(1)+m.group(2)+handles+
 '  handle {\n    try_files {path} /index.html\n    file_server\n  }\n')
 updated=config[:m.start()]+replacement+config[m.end():]
 require(updated!=config and not BACKUP.exists(),'ALREADY_CONFIGURED')
 # All other Caddy sites, including Supabase auth/API, stay byte-for-byte untouched.
 STAGE.mkdir(parents=True,exist_ok=True)
 BACKUP.write_text(config);BACKUP.chmod(0o600)
 try:
  configs[0].write_text(updated)
  run(DOCKER+['exec','supabase-caddy','caddy','validate','--config','/etc/caddy/Caddyfile'],timeout=50)
  run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=50)
 except Exception:
  configs[0].write_text(config)
  try:run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],timeout=50)
  except Exception:print('LITERAL_SHARE_CADDY_ROLLBACK=UNVERIFIED')
  else:print('LITERAL_SHARE_CADDY_ROLLBACK=COMPLETE')
  raise
 print('LITERAL_SECTION_SHARE_ROUTES=ACTIVE')
 print('ORIGINAL_SPA_FALLBACK=UNCHANGED')
 print('OTHER_CADDY_HOSTS=UNCHANGED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('LITERAL_SECTION_SHARE_ROUTES=FAILED_'+str(e)[:220],file=sys.stderr)
  sys.exit(1)
