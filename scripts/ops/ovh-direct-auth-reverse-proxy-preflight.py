#!/usr/bin/env python3
"""Assess an isolated public /auth/v1/ reverse proxy route. Read-only."""
import json, subprocess, re
from pathlib import Path
def docker(*args):
 try: return subprocess.run(['sudo','-n','/usr/bin/docker',*args],capture_output=True,text=True,timeout=13)
 except Exception: return None
raw=docker('inspect','supabase-caddy')
if not raw or raw.returncode:raise SystemExit('DIRECT_AUTH_CADDY_INSPECT=BLOCKED')
meta=json.loads(raw.stdout)[0]
mounts=[m for m in meta.get('Mounts',[]) if m.get('Destination','')=='/etc/caddy/Caddyfile']
print('DIRECT_AUTH_CADDYFILE_MOUNT_COUNT='+str(len(mounts)))
if len(mounts)==1:
 path=Path(mounts[0].get('Source',''))
 print('DIRECT_AUTH_CADDYFILE_HOST_READABLE='+str(path.is_file()))
 print('DIRECT_AUTH_CADDYFILE_MOUNT_MODE='+str(mounts[0].get('RW')))
 if path.is_file():
  src=path.read_text()
  print('DIRECT_AUTH_CADDYFILE_TARGET_UNIQUE='+str(src.count('reverse_proxy api-gw:8000')==1))
  print('DIRECT_AUTH_CADDYFILE_API_MATCH_UNIQUE='+str(src.count('@supabase_api')==2))
  print('DIRECT_AUTH_CADDYFILE_BASIC_AUTH_PROTECTED='+str('basic_auth' in src))
  print('DIRECT_AUTH_CADDYFILE_SITE_BLOCK_COUNT='+str(src.count('file_server')))
for host in ('auth:9999','supabase-auth:9999','api-gw:8000'):
 cmd=['exec','supabase-caddy','wget','-q','--timeout=6','-S','-O','/dev/null','http://'+host+('/settings' if 'auth' in host else '/auth/v1/settings')]
 a=docker(*cmd)
 result=(a.stdout+'\n'+a.stderr) if a else ''
 match=re.search(r'HTTP/[0-9.]+\s+([0-9]{3})',result)
 code=match.group(1) if match else 'UNKNOWN'
 print('CADDY_UPSTREAM_'+host.replace(':','_').replace('-','_')+'_HTTP='+code)
 print('CADDY_UPSTREAM_'+host.replace(':','_').replace('-','_')+'_REACHABLE='+str(bool(match)))
print('DIRECT_AUTH_ASSESSMENT=READ_ONLY_NO_CREDENTIALS')
