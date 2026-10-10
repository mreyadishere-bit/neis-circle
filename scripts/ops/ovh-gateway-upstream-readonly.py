#!/usr/bin/env python3
"""Read-only gateway topology classification with no secrets."""
import re, subprocess
def cmd(*args):
 try:
  return subprocess.run(['sudo','-n','/usr/bin/docker',*args],capture_output=True,text=True,timeout=14)
 except Exception:
  return None
ps=cmd('ps','--format','{{.Names}}')
if ps and ps.returncode==0:
 names=[v.strip() for v in ps.stdout.splitlines() if v.strip()]
 print('GATEWAY_RUNNING_CONTAINERS='+str(len(names)))
 for word in ('envoy','kong','caddy','traefik','nginx','auth','gateway','rest','studio','db'):
  print('GATEWAY_SERVICE_'+word.upper()+'_COUNT='+str(sum(word in n.lower() for n in names)))
for container,path in (('supabase-caddy','/etc/caddy/Caddyfile'),('supabase-envoy','/etc/envoy/envoy.yaml')):
 result=cmd('exec',container,'cat',path)
 if not result or result.returncode!=0:
  print(container.replace('-','_').upper()+'_CONFIG=UNAVAILABLE')
  continue
 lines=result.stdout.splitlines()
 for number,line in enumerate(lines,1):
  clean=line.strip()
  if container=='supabase-caddy' and clean.startswith('reverse_proxy '):
   fields=clean.split()
   target=fields[1] if len(fields)>1 else ''
   category=next((word.upper() for word in ('envoy','kong','nginx','auth','gateway','caddy','traefik') if word in target.lower()),'OTHER')
   print('CADDY_REVERSE_PROXY_LINE_'+str(number)+'_TARGET_CLASS='+category)
   parsed=target.replace('http://','').replace('https://','').split('/')[0]
   if re.fullmatch('[A-Za-z][A-Za-z0-9_.-]{0,48}:[0-9]{2,5}',parsed):
    print('CADDY_REVERSE_PROXY_LINE_'+str(number)+'_UPSTREAM='+parsed)
   else:
    print('CADDY_REVERSE_PROXY_LINE_'+str(number)+'_UPSTREAM=REDACTED')
  if container=='supabase-envoy' and any(term in clean.lower() for term in ('cluster:','cluster_name:','name: envoy.filters','load_assignment','socket_address','address:','port_value:')):
   category=next((term.upper() for term in ('kong','auth','gateway','envoy','nginx','http','tcp_proxy','hcm','rbac') if term in clean.lower()),'OTHER')
   print('ENVOY_CONFIG_LINE_'+str(number)+'_CLASS='+category)
   parts=clean.split(':',1)
   if len(parts)==2 and parts[0] in ('address','cluster','name','port_value'):
    value=parts[1].strip().strip('"').strip("'")
    if len(value)<55 and re.fullmatch('[A-Za-z0-9_.-]+',value):
     print('ENVOY_SAFE_CONFIG_VALUE_'+str(number)+'='+value)
 print(container.replace('-','_').upper()+'_LINES='+str(len(lines)))
# Classify running Docker service images without exposing images tags or runtime environment.
ps2=cmd('ps','--format','{{.Names}}|{{.Image}}')
if ps2 and ps2.returncode==0:
 for line in ps2.stdout.splitlines():
  pieces=line.split('|',1)
  if len(pieces)!=2:continue
  name,image=pieces
  if not name.startswith('supabase-'):continue
  cls=next((w.upper() for w in ('kong','envoy','caddy','traefik','nginx','postgres','gotrue','postgrest','studio','realtime','storage') if w in image.lower()),'OTHER')
  print('DOCKER_CONTAINER_CLASS_'+name.replace('-','_').upper()+'='+cls)
print('GATEWAY_TOPOLOGY_AUDIT=SAFE_READ_ONLY')
