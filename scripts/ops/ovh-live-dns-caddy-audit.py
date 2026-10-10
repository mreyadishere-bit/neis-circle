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
    break
  else:print('CADDY_LIVE_CONFIG=UNAVAILABLE')
  print('CADDY_CONFIG_MOUNT_COUNT='+str(len(meta.get('Mounts') or [])))
 if name=='supabase-envoy':
  p=run('exec',name,'cat','/etc/envoy/envoy.yaml')
  if p and p.returncode==0 and len(p.stdout)<250000:classify('ENVOY_LIVE',p.stdout)
print('AUDIT=SAFE_READ_ONLY')
