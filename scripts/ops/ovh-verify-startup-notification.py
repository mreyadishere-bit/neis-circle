#!/usr/bin/env python3
"""Verify the deployed release externally from the CI runner, after web-server startup."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib, time, urllib.request
FILES = ['scripts/02-content-admin.js', 'scripts/05-social.js',
         'scripts/featured-articles-v160.js', 'scripts/runtime-core-v166.js',
         'scripts/secondary-data-v173.js', 'scripts/social/notifications-v174.js']
MARKER = 'startup=20261023v2'

def read(path):
    req = urllib.request.Request('https://www.neiscircle.site/' + path + '?' + MARKER,
                                 headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError('HTTP status mismatch')
        return response.read()

def main():
    expected = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in FILES}
    for attempt in range(15):
        try:
            index = read('').decode()
            if index.count(MARKER) != 6:
                raise RuntimeError('release marker mismatch')
            with ThreadPoolExecutor(max_workers=6) as pool:
                for path, content in zip(FILES, pool.map(read, FILES)):
                    if hashlib.sha256(content).hexdigest() != expected[path]:
                        raise RuntimeError('public script hash mismatch: ' + path)
            print('STARTUP_NOTIFICATION_DEPLOY=SUCCESS')
            print('PUBLIC_RELEASE_MARKERS=6; PUBLIC_SCRIPT_HASHES=6_VERIFIED')
            return
        except Exception as error:
            print('PUBLIC_VERIFY_RETRY=' + str(attempt + 1) + '; CLASS=' + type(error).__name__)
            if attempt == 14:
                raise
            time.sleep(2)

if __name__ == '__main__':
    main()
