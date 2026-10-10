#!/usr/bin/env python3
"""Classify PKCE exchange responses in Envoy logs without logging URLs, tokens, IPs or users."""
import json,re,subprocess
from collections import Counter
p=subprocess.run(['sudo','-n','/usr/bin/docker','logs','--since','70m','--tail','14000','supabase-envoy'],capture_output=True,text=True,timeout=25)
if p.returncode:raise SystemExit('ENVOY_LOGS=UNAVAILABLE')
counts=Counter(); fieldnames=Counter(); route_count=0
for line in (p.stdout+'\n'+p.stderr).splitlines():
 s=line.lower()
 if '/auth/v1/token' not in s and not ('/token' in s and 'grant_type=pkce' in s):continue
 route_count+=1
 obj=None
 for chunk in (line,line[line.find('{'):] if '{' in line else ''):
  try:
   candidate=json.loads(chunk)
   if isinstance(candidate,dict):obj=candidate;break
  except Exception:pass
 status=None
 if obj:
  for key in obj:
   if isinstance(key,str) and re.fullmatch(r'[a-z_]{1,45}',key):fieldnames[key]+=1
  for key in ('status','response_code','status_code','response_status','http_status','downstream_status'):
   v=obj.get(key)
   if isinstance(v,int) and 100<=v<=599:status=str(v);break
   if isinstance(v,str) and re.fullmatch(r'[1-5][0-9]{2}',v):status=v;break
 if status is None:
  for pat in (r'(?i)(?:response_code|status_code|status|statuscode|response_status|http_status|httpstatus)\s*[=:]\s*[\\"\x27]?([1-5][0-9]{2})\b',r'(?i)\bHTTP/[12](?:\\.\\d)?\s+([1-5][0-9]{2})',r'(?i)\b([1-5][0-9]{2})\s+(?:[0-9]+\s+)?\\\"(?:POST|OPTIONS)'):
   found=re.search(pat,line)
   if found:status=found.group(1);break
 if status is None:
  counts['UNKNOWN']+=1
 else:counts['HTTP_'+status]+=1
print('PKCE_TOKEN_LOG_LINES='+str(route_count))
for k,v in sorted(counts.items()):print('PKCE_TOKEN_'+k+'='+str(v))
print('ENVOY_STRUCTURED_LOG_FIELDS='+','.join(x for x,_ in fieldnames.most_common(24)))
print('DIAGNOSTIC_NO_IDENTIFIERS=YES')
