#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import pathlib,re,subprocess,base64,json,hmac,hashlib,urllib.request,urllib.error,urllib.parse,time
src=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','cat','/srv/neis-circle/index.html'],capture_output=True,text=True,timeout=15)
if src.returncode:raise SystemExit('LIVE_APP=UNREADABLE')
scripts=re.findall(r'<script[^>]*src=["\x27]([^"\x27]+)',src.stdout,re.I)
for v in scripts:
 if v.startswith('scripts/') and re.fullmatch('[a-zA-Z0-9_./?&=-]+',v):
  print('LIVE_SCRIPT='+v[:125])
names=[v for v in scripts if any(x in v for x in ('runtime-core','profile-cache','main-data','01-core'))]
print('LIVE_CORE_SCRIPT_COUNT='+str(len(names)))
env={}
for ln in pathlib.Path('.env').read_text().splitlines():
 if ln.startswith(('ANON_KEY=','JWT_SECRET=')):
  k,_,v=ln.partition('=')
  env[k]=v.strip().strip('"').strip("'")
if not env.get('ANON_KEY') or not env.get('JWT_SECRET'):raise SystemExit('LIVE_PROJECTION=BLOCKED_SECRET')
def b64(o):return base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).decode().rstrip('=')
now=int(time.time())
raw=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'aud':'authenticated','role':'authenticated','sub':'00000000-0000-4000-8000-000000000000','iat':now,'exp':now+120,'iss':'supabase'})
sig=base64.urlsafe_b64encode(hmac.new(env['JWT_SECRET'].encode(),raw.encode(),hashlib.sha256).digest()).decode().rstrip('=')
jwt=raw+'.'+sig
routes=[
 ('PROFILE_LIST','profiles','id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete'),
 ('POST_LIST','posts','id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type'),
 ('EXACT_HOME_POSTS','posts','id,kind,title,body,tags,image_url,image_urls,image_display_mode,link_button_label,link_button_url,youtube_url,created_at,author_id,circle_id,pinned,post_type,profiles!posts_author_id_fkey(id,full_name,username,avatar_url,grade,branch,campus)'),
 ('EXACT_HOME_PROFILE','profiles','id,full_name,username,avatar_url,grade,branch,campus,bio,interests,role,onboarding_complete'),
 ('LEGACY_POST_JOIN','posts','id,kind,title,body,tags,created_at,author_id,profiles!posts_author_id_fkey(full_name,grade,campus)'),
 ('COMMENT_COUNTS','comments','post_id'),
 ('REACTIONS','reactions','post_id,user_id,reaction'),
]
for label,table,select in routes:
 url='https://supabase.neiscircle.site/rest/v1/'+table+'?'+urllib.parse.urlencode({'select':select,'limit':'1'})
 req=urllib.request.Request(url,headers={'apikey':env['ANON_KEY'],'Authorization':'Bearer '+jwt,'Prefer':'count=exact','Range':'0-0','Origin':'https://neiscircle.site'})
 try:res=urllib.request.urlopen(req,timeout=12)
 except urllib.error.HTTPError as e:res=e
 except Exception:
  print(label+'_NETWORK=FAILED')
  continue
 with res:
  cr=res.headers.get('Content-Range','').split('/')[-1]
  print(label+'_STATUS='+str(res.status))
  print(label+'_VISIBLE_COUNT='+(cr if cr.isdigit() else 'UNKNOWN'))
  if res.status>=400:
   try:
    p=json.loads(res.read(1500))
    print(label+'_ERROR_CODE='+str(p.get('code','unknown')).replace(' ','')[:30])
   except Exception:print(label+'_ERROR_CODE=NON_JSON')
print('LIVE_PROJECTION=STATUS_ONLY_NO_USER_CONTENT')
PY
