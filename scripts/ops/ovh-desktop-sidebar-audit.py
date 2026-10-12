#!/usr/bin/env python3
"""Read-only inspect deployed sidebar structure; no accounts, sessions, secrets, or PII."""
import json,re,subprocess
from pathlib import Path
inspect=subprocess.run(["sudo","-n","/usr/bin/docker","inspect","supabase-caddy"],
                       capture_output=True,text=True,timeout=15,check=True)
result=json.loads(inspect.stdout)[0]
roots=[x["Source"] for x in result.get("Mounts",[]) if
 x.get("Type")=="bind" and x.get("Destination")=="/srv/neis-circle"]
assert len(roots)==1
root=Path(roots[0])
assert root.is_dir()
html=(root/"index.html").read_text()
print("SIDEBAR_AUDIT=BEGIN")
print("RELEASE_HAS_CORE="+str((root/"scripts/01-core.js").is_file()))
print("RELEASE_INDEX_HTML_BYTES="+str(len(html)))
for term in ("class=\"rail\"","class='rail'","rail-nav","rail-bottom","data-nav=\"home\"",
             'id="railAvatar"','data-action="settings"','nav-btn','bottom-nav','<body'):
 print("SIDEBAR_MATCH_"+re.sub("[^A-Z_]","_",term.upper())+"="+str(html.count(term)))
# Print only sidebar markup, omitting SVG markup and inline event/data attributes.
start=re.search(r"<(?:aside|nav|div)\b[^>]{0,300}\bclass\s*=\s*['\"][^'\"]*\brail\b[^'\"]*['\"][^>]*>",html)
if start:
 section=html[start.start():start.start()+12000]
 section=re.sub(r"<svg[\s\S]*?</svg>","[icon]",section,flags=re.I)
 section=re.sub(r"<script[\s\S]*?</script>","",section,flags=re.I)
 section=re.sub(r"<[^>]*data-(?:email|user|token|key|uid|secret|session)[^>]*>","[redacted]",section,flags=re.I)
 section=section[:4600]
 print("SIDEBAR_SANITIZED_MARKUP_BEGIN")
 print(section)
 print("SIDEBAR_SANITIZED_MARKUP_END")
# Check style layout breakpoint and potential conflicting CSS overrides.
style=(root/"styles/app.css").read_text()
for match in re.finditer(r"[^{}]{0,130}(?:\.rail|\.rail-nav|\.nav-btn|\.rail-bottom)[^{}]{0,180}\{[^{}]{0,300}\}",style):
 rule=match.group().strip()
 if any(s in rule for s in ('.rail{','.rail-nav{','.rail-bottom{','.nav-btn{','body.rtl .rail')):
  print("SIDEBAR_STYLE="+rule[:650])
print("SIDEBAR_AUDIT=READ_ONLY_DONE")