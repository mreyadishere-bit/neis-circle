#!/usr/bin/env python3
from urllib.request import Request,urlopen
from urllib.error import URLError,HTTPError
import time,statistics,re,sys
host='https://www.neiscircle.site'
paths=['/','/scripts/pwa-install-v117.js?pushfix=20261010','/scripts/01-core.js','/neis-pwa-sw.js?v=12']
passed=True
for path in paths:
 values=[]
 for _ in range(2):
  try:
   start=time.perf_counter()
   with urlopen(Request(host+path,headers={'Cache-Control':'no-cache','User-Agent':'NEIS-perf-audit'}),timeout=20) as r:
    response=r.read(6000000)
    elapsed=round((time.perf_counter()-start)*1000)
    values.append(elapsed)
    if r.status!=200:passed=False
    if path=='/':
     text=response.decode('utf-8','replace')
     print('PUBLIC_APP_MAINTENANCE='+str("We'll be back soon" in text))
     passed=passed and "We'll be back soon" not in text
    if 'pwa-install' in path:
     text=response.decode('utf-8','replace')
     print('PUBLIC_PUSHFIX_TIMEOUT_PRESENT='+str('pushWithTimeout(' in text))
     passed=passed and 'pushWithTimeout(' in text
  except Exception as exc:
   print('PUBLIC_ROUTE_ERROR='+path.split('?')[0]+'_'+type(exc).__name__)
   passed=False
 if values:print('PUBLIC_ROUTE_'+re.sub('[^A-Za-z0-9]+','_',path.split('?')[0]).strip('_')+'_MEDIAN_MS='+str(round(statistics.median(values))))
print('PUBLIC_PERF_SMOKE='+('PASS' if passed else 'FAIL'))
sys.exit(0 if passed else 1)
