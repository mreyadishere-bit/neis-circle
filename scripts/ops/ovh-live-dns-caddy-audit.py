#!/usr/bin/env python3
"""Read-only IP/DNS and live Caddy/Envoy policy audit. No auth secrets printed."""
import json,re,socket,hashlib,subprocess
from pathlib import Path
host='supabase.neiscircle.site'
def digest_addresses():
 try:
  values=sorted(set((item[0],item[4][0]) for item in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
  data=';'.join(str(fam)+':'+ip for fam,ip in values)
  print('DNS_ADDRESS_HASH='+hashlib.sha256(data.encode()).hexdigest()[:16])
  print('DNS_A_RECORD_COUNT='+str(sum(fam==socket.AF_INET for fam,_ in values)))
  print('DNS_AAAA_RECORD_COUNT='+str(sum(fam==socket.AF_INET6 for fam,_ in values)))
 except Exception:print('DNS_RESOLUTION=FAILED')
digest_addresses()
def inspect(name):
 try:
  p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect',name],capture_output=True,text=True,timeout=12)
  return json.loads(p.stdout)[0] if p.returncode==0 else {}
 except Exception:return {}
def run(*args):
 try:return subprocess.run(['sudo','-n','/usr/bin/docker',*args],capture_output=True,text=True,timeout=15)
 except Exception:return None
def classify(prefix,data):
 low=data.lower()
 print(prefix+'_BYTES='+str(len(data)))
 print(prefix+'_PUBLIC_API_DOMAIN='+str('supabase.neiscircle.site' in low))
 for flag,terms in {
  'BASIC_AUTH':('basic_auth','basicauth'),
  'FORWARD_AUTH':('forward_auth','ext_authz'),
  'IP_MATCHER':('remote_ip','client_ip','source_ip','remoteip'),
  'DENY_STATUS':('respond 401','respond "unauthorized"','status: 401','status_code: 401','direct_response'),
  'REVERSE_PROXY':('reverse_proxy','proxy_pass','upstreams'),
  'ENVIRONMENT_AUTH':('basicauth','authentication','bearer','api_key'),
  'RATE_LIMIT':('rate_limit','rate-limit','limit_req')
 }.items():print(prefix+'_'+flag+'='+str(any(t in low for t in terms)))
 lines=data.splitlines()
 safe=[]
 for i,line in enumerate(lines):
  t=line.strip().lower()
  if not t or t.startswith('#'):continue
  kinds=[]
  for label,words in [('PUBLIC_SITE',('supabase.neiscircle.site',)),('BASIC_AUTH',('basic_auth','basicauth')),('AUTH_GATE',('forward_auth','ext_authz')),('CLIENT_IP',('remote_ip','client_ip')),('PROXY',('reverse_proxy','proxy_pass')),('HANDLE',('handle','route')),('REJECT_401',('respond 401','status: 401','status_code: 401')),('MATCHER',('@private','@protected','@public','@blocked','@api'))]:
   if any(t2 in t for t2 in words):kinds.append(label)
  if kinds:safe.append(str(i+1)+':'+','.join(kinds))
 print(prefix+'_STRUCTURE='+';'.join(safe[:90]))
def emit_safe_caddy_structure(data):
 allowed={'handle','handle_path','route','reverse_proxy','basic_auth','basicauth','respond','root','file_server','host','path','@studio','@public','@api','@private','@auth','@protected','@blocked','encode','tls','redir','header','log','import'}
 hide=False
 for i,line in enumerate(data.splitlines(),1):
  clean=line.strip()
  if not clean or clean.startswith('#'):continue
  if hide:
   if clean=='}':
    hide=False
    print('CADDY_SAFE_LINE_'+str(i)+'=}')
   else:print('CADDY_SAFE_LINE_'+str(i)+'=CREDENTIAL_REDACTED')
   continue
  parts=clean.replace('{',' { ').replace('}',' } ').split()
  if not parts:continue
  first=parts[0].lower()
  if first in ('basic_auth','basicauth'):
   print('CADDY_SAFE_LINE_'+str(i)+'=BASIC_AUTH_OPEN')
   hide='{' in clean
  elif clean in ('{','}') or first.endswith('{') or first.startswith('https://') or first.startswith(':'):
   print('CADDY_SAFE_LINE_'+str(i)+'='+('OPEN_BRACE' if clean=='{' else 'CLOSE_BRACE' if clean=='}' else 'SITE_OR_BLOCK'))
  elif first in allowed or first.startswith('@'):
   if first in ('header','log','tls','import'):
    print('CADDY_SAFE_LINE_'+str(i)+'='+first.upper()+'_REDACTED')
   else:
    safe=[]
    for token in parts[:5]:
     low=token.lower()
     if token in ('{','}') or re.fullmatch(r'@[A-Za-z0-9_-]{1,40}',token) or token.lower() in allowed or token in ('*','/','/*'):
      safe.append(token)
     elif token.startswith('/') and len(token)<80 and re.fullmatch(r'/[A-Za-z0-9_/*.-]*',token):safe.append(token)
     elif token in ('supabase-envoy:8000','supabase-envoy:10000','supabase-auth:9999','supabase-studio:3000'):
      safe.append(token)
     elif token in ('401','403','404'):safe.append(token)
     else:safe.append('VALUE_REDACTED')
    print('CADDY_SAFE_LINE_'+str(i)+'='+' '.join(safe))
  else:print('CADDY_SAFE_LINE_'+str(i)+'=OTHER_DIRECTIVE')

for name in ('supabase-caddy','supabase-envoy'):
 meta=inspect(name)
 print(name.replace('-','_').upper()+'_RUNNING='+str(meta.get('State',{}).get('Running',False)))
 if name=='supabase-caddy':
  files=['/etc/caddy/Caddyfile','/config/Caddyfile','/srv/Caddyfile']
  cmd=meta.get('Config',{}).get('Cmd',[])
  if isinstance(cmd,list):
   for i,x in enumerate(cmd):
    if x in ('--config','-config') and i+1<len(cmd):files.append(cmd[i+1])
  for f in dict.fromkeys(files):
   if not f.startswith('/'):continue
   p=run('exec',name,'cat',f)
   if p and p.returncode==0 and len(p.stdout)<250000:
    classify('CADDY_LIVE',p.stdout)
    emit_safe_caddy_structure(p.stdout)
    break
  else:print('CADDY_LIVE_CONFIG=UNAVAILABLE')
  print('CADDY_CONFIG_MOUNT_COUNT='+str(len(meta.get('Mounts') or [])))
 if name=='supabase-envoy':
  p=run('exec',name,'cat','/etc/envoy/envoy.yaml')
  if p and p.returncode==0 and len(p.stdout)<250000:classify('ENVOY_LIVE',p.stdout)
print('AUDIT=SAFE_READ_ONLY')
