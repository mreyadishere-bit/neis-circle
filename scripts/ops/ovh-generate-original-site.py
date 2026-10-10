#!/usr/bin/env python3
"""Stage original NEIS Circle Google-only site without altering its UI or onboarding."""
import os,re,subprocess
from pathlib import Path
baseline="78e89de3acd637622d8faabd91b7beffa1b6171f"
key=os.environ.get("OVH_PUBLIC_ANON_KEY","")
if not key.startswith("eyJ") or key.count(".")!=2:raise SystemExit("SITE_PREP=INVALID_PUBLIC_KEY")
def original(path):
 p=subprocess.run(["git","show",baseline+":"+path],capture_output=True,timeout=25)
 if p.returncode:raise RuntimeError("SITE_PREP=MISSING_BASELINE")
 return p.stdout
index=original("index.html").decode("utf-8")
cloud="https://ydieijgynqlckaczalju.supabase.co"
ovh="https://supabase.neiscircle.site"
if index.count('supabaseUrl: "'+cloud+'"')!=1 or index.count("supabaseAnonKey: ")!=1:
 raise RuntimeError("SITE_PREP=WRONG_INDEX_BASELINE")
index=index.replace(cloud,ovh)
index,n=re.subn(r'(supabaseAnonKey:\s*")[^"]+(")',lambda m:m.group(1)+key+m.group(2),index)
if n!=1 or cloud in index:raise RuntimeError("SITE_PREP=INVALID_ENDPOINT_PATCH")
if "scripts/identity-v15.js" not in index:raise RuntimeError("SITE_PREP=GOOGLE_IDENTITY_SCRIPT_MISSING")
Path("index.html").write_text(index)
Path("404.html").write_bytes(original("404.html"))
sw=Path("neis-pwa-sw.js").read_text()
old=cloud+"/functions/v1/refresh-web-push-subscription"
if sw.count(old)!=1:raise RuntimeError("SITE_PREP=SW_REF_MISMATCH")
Path("neis-pwa-sw.js").write_text(sw.replace(old,ovh+"/functions/v1/refresh-web-push-subscription"))
print("SITE_PREP=GOOGLE_ONLY_ORIGINAL_INTERFACE_RESTORED")
print("SITE_PREP=OVH_PUBLIC_CLIENT_CONFIGURATION_APPLIED")
