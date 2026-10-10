#!/usr/bin/env python3
"""Read-only probe for the real 401 from /auth/v1/token.

No real auth code, personal data, JWT or API key is printed.
"""
import os,json,re,subprocess,urllib.request,urllib.error
from pathlib import Path
from collections import Counter
root=Path('/home/ubuntu/neis-supabase')
envfile=root/'.env'
env={}
for line in envfile.read_text().splitlines():
 if line.startswith(('ANON_KEY=','JWT_SECRET=')):
  key,val=line.partition('=')[::2]
  env[key]=val.strip().strip('"').strip("'")
anon=env.get('ANON_KEY','')
frontend=root.parent/'neis-frontend/releases/ovh-selfhosted-20261010-pkce-verifier-v6/scripts/01-core.js'
client=''
if frontend.is_file():
 m=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',frontend.read_text())
 if m:client=m.group(1)
print('GATEWAY_ENV_ANON_PRESENT='+str(bool(anon)))
print('GATEWAY_FRONTEND_KEY_PRESENT='+str(bool(client)))
print('GATEWAY_FRONTEND_ANON_MATCH='+str(bool(anon) and anon==client))
for name in ('supabase-envoy','supabase-kong','supabase-auth'):
 try:
  a=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .Config.Env}}',name],capture_output=True,text=True,timeout=12)
  running=dict(t.split('=',1) for t in json.loads(a.stdout) if '=' in t) if a.returncode==0 else {}
 except Exception:running={}
 print('CONTAINER_'+name.replace('-','_').upper()+'_EXISTS='+str(bool(running)))
 for field in ('ANON_KEY','SUPABASE_ANON_KEY','JWT_SECRET','GOTRUE_JWT_SECRET'):
  if field in running:
   print(name.replace('-','_').upper()+'_'+field+'_MATCH_ENV='+str(running[field] in (anon if field.endswith('ANON_KEY') else env.get('JWT_SECRET',''),)))
body=json.dumps({'auth_code':'synthetic-neis-invalid-authorization-code-only','code_verifier':'A'*64}).encode()
base='https://supabase.neiscircle.site'
def classify(raw):
 try:data=json.loads(raw)
 except Exception:return 'NON_JSON'
 if not isinstance(data,dict):return 'NON_OBJECT'
 message=' '.join(str(data.get(k,'')) for k in ('error','error_code','message','msg','code','error_description')).lower()
 if any(t in message for t in ('invalid api key','invalid_api_key','invalid apikey')):return 'INVALID_API_KEY'
 if any(t in message for t in ('no api key','missing api key','no api-key')):return 'MISSING_API_KEY'
 if 'api key' in message or 'apikey' in message:return 'API_KEY_REJECTED'
 if any(t in message for t in ('invalid jwt','bad jwt','jwt secret','signature invalid')):return 'JWT_REJECTED'
 if 'auth code' in message or 'invalid code' in message or 'invalid_grant' in message:return 'INVALID_AUTH_CODE'
 if 'code_verifier' in message or 'pkce' in message:return 'VERIFIER_OR_PKCE'
 if 'unauthoriz' in message:return 'UNAUTHORIZED_GENERIC'
 if 'route' in message and ('not found' in message or 'no route' in message):return 'ROUTE_NOT_FOUND'
 if 'credential' in message:return 'CREDENTIAL_REJECTED'
 return 'OTHER_JSON_KEYS_'+','.join(sorted(k for k in data if re.fullmatch('[A-Za-z_]+',k))[:5])
def test(label,path,with_key,with_bearer=False):
 headers={'Origin':'https://neiscircle.site','Content-Type':'application/json','User-Agent':'NEIS-Gateway-401-Classifier'}
 if with_key:headers['apikey']=anon
 if with_bearer:headers['authorization']='Bearer '+anon
 req=urllib.request.Request(base+path,data=body if '/token' in path else None,headers=headers,method='POST' if '/token' in path else 'GET')
 try:r=urllib.request.urlopen(req,timeout=13)
 except urllib.error.HTTPError as e:r=e
 except Exception:print(label+'_NETWORK_ERROR=YES');return
 with r:
  bodypart=r.read(2048).decode('utf-8','replace')
  print(label+'_STATUS='+str(r.status))
  print(label+'_CLASS='+classify(bodypart))
  print(label+'_CORS_OK='+str(r.headers.get('Access-Control-Allow-Origin') in ('https://neiscircle.site','*')))
if anon:
 test('TOKEN_NO_KEY','/auth/v1/token?grant_type=pkce',False)
 test('TOKEN_WITH_ANON','/auth/v1/token?grant_type=pkce',True)
 test('TOKEN_WITH_ANON_BEARER','/auth/v1/token?grant_type=pkce',True,True)
 test('AUTH_SETTINGS_ANON','/auth/v1/settings',True)
 print('AUTH_PROBE=NO_VALID_USERS_NO_SECRETS')
