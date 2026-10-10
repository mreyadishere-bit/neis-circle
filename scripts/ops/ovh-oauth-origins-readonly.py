#!/usr/bin/env python3
"""Read-only PKCE origin, public asset and Auth runtime diagnostic.

No OAuth codes, tokens, emails, redirect URLs or raw server logs are printed.
"""
import fnmatch, json, re, subprocess, urllib.error, urllib.parse, urllib.request
from collections import Counter

HOSTS=('neiscircle.site','www.neiscircle.site')
def fetch(url,method='GET',timeout=13):
    req=urllib.request.Request(url,method=method,headers={
        'User-Agent':'NEIS-OAuth-Origin-Readonly/1','Cache-Control':'no-cache'})
    try:
        r=urllib.request.urlopen(req,timeout=timeout)
    except urllib.error.HTTPError as e:
        r=e
    except Exception:
        return 0,'',None
    with r:
        return r.status,r.read(1000000).decode('utf-8','replace'),r.headers.get('Location')

inspect=subprocess.run(['sudo','-n','/usr/bin/docker','inspect',
                        '--format','{{json .Config.Env}}','supabase-auth'],
                        stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=15)
if inspect.returncode==0:
    try: env=dict(x.split('=',1) for x in json.loads(inspect.stdout) if '=' in x)
    except Exception: env={}
else:env={}
site=env.get('GOTRUE_SITE_URL','')
allowed=[x.strip().rstrip('/') for x in env.get('GOTRUE_URI_ALLOW_LIST','').split(',') if x.strip()]
print('AUTH_ENV_INSPECT='+('YES' if env else 'NO'))
print('AUTH_SITE_CANONICAL_APEX='+str(site.rstrip('/')=='https://neiscircle.site'))
for host in HOSTS:
    desired='https://'+host
    matched=(desired.rstrip('/')==site.rstrip('/') or any(
        fnmatch.fnmatch(desired,pattern) or fnmatch.fnmatch(desired+'/',pattern)
        for pattern in allowed))
    print('AUTH_REDIRECT_ALLOWED_'+host.replace('.','_').upper()+'='+str(matched))
for host in HOSTS:
    base='https://'+host
    http,html,_=fetch(base+'/')
    script_status,js,_=fetch(base+'/scripts/01-core.js?check=pkce-origin-20261010')
    identity_status,identity,_=fetch(base+'/scripts/identity-v15.js?check=pkce-origin-20261010')
    print('WEB_'+host.replace('.','_').upper()+'_HOME_HTTP='+str(http))
    print('WEB_'+host.replace('.','_').upper()+'_CORE_HTTP='+str(script_status))
    print('WEB_'+host.replace('.','_').upper()+'_IDENTITY_HTTP='+str(identity_status))
    print('WEB_'+host.replace('.','_').upper()+'_PKCE_ENABLED='+str("flowType:'pkce'" in js))
    print('WEB_'+host.replace('.','_').upper()+'_GOOGLE_ONLY_UI='+str('Continue with Google' in identity))
    print('WEB_'+host.replace('.','_').upper()+'_APP_HTML='+str('scripts/01-core.js' in html))
for host in HOSTS:
    params=urllib.parse.urlencode({'provider':'google','redirect_to':'https://'+host+'/',
                                  'code_challenge':'A'*43,'code_challenge_method':'s256'})
    url='https://supabase.neiscircle.site/auth/v1/authorize?'+params
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):return None
    opener=urllib.request.build_opener(NoRedirect)
    req=urllib.request.Request(url,headers={'User-Agent':'NEIS-OAuth-Origin-Readonly/1'})
    try:r=opener.open(req,timeout=13)
    except urllib.error.HTTPError as e:r=e
    except Exception:r=None
    if r:
        with r:
            status=r.status
            provider=urllib.parse.urlsplit(r.headers.get('Location','')).hostname
    else:status=0;provider=None
    print('OAUTH_'+host.replace('.','_').upper()+'_HTTP='+str(status))
    print('OAUTH_'+host.replace('.','_').upper()+'_GOOGLE_REDIRECT='+str(provider=='accounts.google.com'))
logs=subprocess.run(['sudo','-n','/usr/bin/docker','logs','--since','35m',
                     '--tail','2000','supabase-auth'],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
if logs.returncode!=0:
    print('AUTH_LOGS=UNAVAILABLE')
else:
    counts=Counter()
    for line in (logs.stdout+'\n'+logs.stderr).splitlines():
        lower=line.lower()
        if '/auth/v1' not in lower and not any(x in lower for x in
               ('/token','/callback','code_verifier','flow state','pkce')):continue
        category='TOKEN' if '/token' in lower else ('CALLBACK' if '/callback' in lower else 'OTHER')
        status=re.search(r'\b(?:status|status_code|response_status)\W+([1-5][0-9]{2})\b',lower)
        if status:counts[category+'_'+status.group(1)]+=1
        elif 'code_verifier' in lower or 'flow state' in lower:counts['PKCE_VERIFIER_ERROR']+=1
        elif 'pkce' in lower:counts['PKCE_OTHER']+=1
    for k,n in sorted(counts.items()):print('AUTH_LOG_'+k+'='+str(n))
    print('AUTH_LOG_AGGREGATED_EVENTS='+str(sum(counts.values())))
print('DIAGNOSTIC_READ_ONLY=YES')
