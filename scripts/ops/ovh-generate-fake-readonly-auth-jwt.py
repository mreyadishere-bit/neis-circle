#!/usr/bin/env python3
# Emit only a short-lived, fake-user JWT for diagnosing authenticated read-only browser requests.
# Does not create an account, touch database data, or print JWT secret.
import base64,json,hmac,hashlib,time
from pathlib import Path
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if line.startswith('JWT_SECRET='):
  secret=line.partition('=')[2].strip().strip('"').strip("'")
  break
else:raise SystemExit(1)
if len(secret)<24:raise SystemExit(1)
def enc(x):return base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
now=int(time.time())
value=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({
 'aud':'authenticated','role':'authenticated','sub':'00000000-0000-4000-8000-000000000000',
 'iat':now,'exp':now+180,'iss':'supabase'
})
mac=base64.urlsafe_b64encode(hmac.new(secret.encode(),value.encode(),hashlib.sha256).digest()).decode().rstrip('=')
print(value+'.'+mac)
