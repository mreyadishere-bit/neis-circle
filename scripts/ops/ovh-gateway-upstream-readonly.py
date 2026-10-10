#!/usr/bin/env python3
"""Read-only gateway topology classification (no addresses/secrets printed)."""
import re,subprocess,json,urllib.request,urllib.error
from pathlib import Path
def cmd(*args):
 try:return subprocess.run(['sudo','-n','/usr/bin/docker',*args],capture_output=True,text=True,timeout=14)
 except Exception:return None
ps=cmd('ps','--format','{{.Names}}')
if ps and ps.returncode==0:
 names=[x.strip() for x in ps.stdout.splitlines() if x.strip()]
 print('GATEWAY_RUNNING_CONTAINERS='+str(len(names)))
 for term in ('envoy','kong','caddy','traefik','nginx','auth','gateway','rest','studio','db'):
  print('GATEWAY_SERVICE_'+term.upper()+'_COUNT='+str(sum(term in n.lower() for n in names)))
for cname,path in [('supabase-caddy','/etc/caddy/Caddyfile'),('supabase-envoy','/etc/envoy/envoy.yaml')]:
 p=cmd('exec',cname,'cat',path)
 if not p or p.returncode!=0:
  print(cname.replace('-','_').upper()+'_CONFIG=UNAVAILABLE');continue
 lines=p.stdout.splitlines()
 for i,line in enumerate(lines):
  clean=line.strip()
  if cname=='supabase-caddy' and clean.startswith('reverse_proxy '):
   target=clean.split()[1] if len(clean.split())>1 else ''
   up=target.lower()
   kind=next((x.upper() for x in ('envoy','kong','nginx','auth','gateway','caddy','traefik') if x in up),'OTHER')
   print('CADDY_REVERSE_PROXY_LINE_'+str(i+1)+'_TARGET_CLASS='+kind)
  if cname=='supabase-envoy' and any(x in clean.lower() for x in ('cluster:','cluster_name:','name: envoy.filters','load_assignment','socket_address','address:','port_value:')):
   kind=next((x.upper() for x in ('kong','auth','gateway','envoy','nginx','http','tcp_proxy','hcm','rbac') if x in clean.lower()),'OTHER')
   print('ENVOY_CONFIG_LINE_'+str(i+1)+'_CLASS='+kind)
 print(cname.replace('-','_').upper()+'_LINES='+str(len(lines)))
print('GATEWAY_TOPOLOGY_AUDIT=SAFE_READ_ONLY')
