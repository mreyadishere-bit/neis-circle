#!/usr/bin/env python3
"""Read-only Caddy/Envoy external Auth 401 inspection, never print config secrets."""
import json,re,subprocess,urllib.request,urllib.error
from pathlib import Path
root=Path('/home/ubuntu/neis-supabase')
def docker(*args):
 try:return subprocess.run(['sudo','-n','/usr/bin/docker',*args],capture_output=True,text=True,timeout=18)
 except Exception:return None
def classify(label,data):
 low=data.lower()
 print(label+'_CHAR_COUNT='+str(len(data)))
 print(label+'_HAS_AUTH_DOMAIN='+str('supabase.neiscircle.site' in low))
 for field,patterns in {
  'BASIC_AUTH':('basic_auth','basicauth'),
  'FORWARD_AUTH':('forward_auth','ext_authz'),
  'IP_MATCHER':('remote_ip','client_ip','source_ip'),
  'JWT_FILTER':('jwt_authn','jwt_verification','jwt_authentication'),
  'RBAC_FILTER':('rbac','access_control','denylist','allowlist'),
  'HTTP_401_RULE':('respond 401','respond "unauthorized"','status: 401','status_code: 401','direct_response'),
  'REVERSE_PROXY':('reverse_proxy','envoy','proxy_pass'),
  'CADDY_SITE_BLOCK':('supabase.neiscircle.site',),
 }.items():
  print(label+'_'+field+'='+str(any(p in low for p in patterns)))
 lines=data.splitlines()
 matches=[]
 for i,line in enumerate(lines):
  stripped=line.strip()
  if not stripped or stripped.startswith('#'):continue
  if re.search('(?i)(auth|token|secret|jwt|password|credentials|api.key)',stripped) and not any(x in stripped for x in ('supabase.neiscircle.site','basic_auth','forward_auth','ext_authz','jwt_authn','unauthorized','auth/v1')):
   continue
  tags=[]
  for word in ('supabase.neiscircle.site','remote_ip','client_ip','basic_auth','basicauth','forward_auth','reverse_proxy','respond','handle_path','handle','route','jwt_authn','ext_authz','rbac','direct_response'):
   if word in stripped:tags.append(word)
  if '401' in stripped:tags.append('401')
  if tags:matches.append(str(i+1)+':'+','.join(tags))
 print(label+'_CONTROL_LINE_TAGS='+';'.join(matches[:90]))
for name in ('supabase-caddy','supabase-envoy'):
 inspected=docker('inspect',name)
 if inspected and inspected.returncode==0:
  try:
   meta=json.loads(inspected.stdout)[0]
   print(name.upper().replace('-','_')+'_RUNNING='+str(meta.get('State',{}).get('Running',False)))
   mounts=meta.get('Mounts',[])
   for mount in mounts:
    target=str(mount.get('Destination',''))
    source=str(mount.get('Source',''))
    if any(x in target.lower() for x in ('caddyfile','envoy.yaml','envoy.yml','nginx.conf')):
     path=Path(source)
     if path.is_file() and path.stat().st_size<400000:
      classify(name.replace('-','_').upper()+'_HOST_CONFIG',path.read_text(errors='replace'))
     else:
      print(name.replace('-','_').upper()+'_HOST_CONFIG_UNREADABLE=YES')
  except Exception:print(name.replace('-','_').upper()+'_INSPECT_PARSE=ERROR')
for label,path in [('CADDYFILE',root/'Caddyfile'),('CADDY_DIR',root/'caddy/Caddyfile'),('ENVOY_YAML',root/'envoy.yaml'),('ENVOY_CONFIG',root/'envoy/envoy.yaml'),('EDGE_CADDY',root/'volumes/api/Caddyfile')]:
 if path.is_file() and path.stat().st_size<400000:classify(label,path.read_text(errors='replace'))
for name,path in [('COMPOSE_SECURITY',root/'docker-compose.security.yml'),('COMPOSE_CADDY',root/'docker-compose.caddy.yml'),('COMPOSE_EDGE',root/'docker-compose.edge-integrations.yml')]:
 if path.is_file() and path.stat().st_size<400000:classify(name,path.read_text(errors='replace'))
print('EXTERNAL_401_POLICY_AUDIT=READ_ONLY_NO_SECRETS')
