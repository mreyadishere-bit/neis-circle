#!/usr/bin/env python3
"""Private, read-only NEIS VPS monitor. stdlib-only; binds loopback exclusively."""
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import urlsplit

HOST = "127.0.0.1"
PORT = 8765
LOGO = "NEIS Circle"
LOCK = threading.Lock()
HISTORY = deque(maxlen=360)
CACHE = {"at": 0.0, "payload": None}
PREV_CPU = None
PREV_NET = None
DB_CACHE = {"at": 0.0, "bytes": None}

HTML = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b1120"><title>NEIS Circle · Private Server Monitor</title>
<style>
:root{color-scheme:dark;--bg:#0b1120;--panel:#121c2d;--panel2:#182539;--border:#2b3b50;--text:#e8f1fe;--muted:#9fb0c5;--accent:#79b5fa;--ok:#5de6b4;--warn:#ffc977;--bad:#fc8090}
*{box-sizing:border-box}body{background:var(--bg);color:var(--text);margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 20px 56px}
header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:27px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}.logo{display:grid;place-items:center;width:43px;height:43px;border-radius:12px;background:#e8f1fe;color:#102b58;font-weight:900;font-size:19px}
h1{font-size:22px;line-height:1.2;margin:0}h2{font-size:15px;margin:0 0 16px;font-weight:650}.sub,.hint{color:var(--muted);font-size:12px;margin:4px 0 0}
.status{font-size:12px;color:var(--ok);border:1px solid #275744;background:#12382d;border-radius:40px;padding:7px 12px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:21px;min-width:0}
.card .label{color:var(--muted);font-size:12px;margin-bottom:8px}.value{font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-.6px;font-variant-numeric:tabular-nums}
.track{background:#293c53;height:6px;border-radius:6px;margin-top:19px;overflow:hidden}
.track span{display:block;width:0;height:100%;border-radius:6px;background:var(--ok);transition:width .4s}
.cols{display:grid;grid-template-columns:1.5fr 1fr;gap:15px;margin-top:15px}
.plot{width:100%;height:175px;display:block;overflow:visible}
table{border-collapse:collapse;width:100%;font-size:13px}th{color:var(--muted);font-weight:500;text-align:left;font-size:12px}
td,th{padding:11px 9px;border-bottom:1px solid var(--border)}td:first-child{font-weight:600;overflow-wrap:anywhere}
.info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.datum{background:var(--panel2);border-radius:10px;padding:12px}
.datum b{display:block;font-size:18px;font-weight:650;margin-top:3px}.dot{width:7px;height:7px;border-radius:100%;background:var(--ok);display:inline-block;margin-right:5px}
.empty{color:var(--muted);padding:25px 0}.foot{color:var(--muted);margin-top:26px;font-size:12px}
@media(max-width:840px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:1fr}}
@media(max-width:480px){main{padding:19px 12px 32px}.cards{gap:10px}.card{padding:16px}.value{font-size:25px}}
</style></head>
<body><main>
<header><div class="brand"><div class="logo">N</div><div><h1>Server overview</h1><p class="sub">NEIS Circle · OVH VPS · private local access</p></div></div><div class="status" id="online">● Connecting...</div></header>
<section class="cards">
<div class="card"><div class="label">CPU usage</div><div class="value" id="cpu">—</div><div class="hint" id="cpuSub">4 vCores configured</div><div class="track"><span id="cpuBar"></span></div></div>
<div class="card"><div class="label">Memory used</div><div class="value" id="ram">—</div><div class="hint" id="ramSub">of 8 GB configured</div><div class="track"><span id="ramBar"></span></div></div>
<div class="card"><div class="label">Disk used</div><div class="value" id="disk">—</div><div class="hint" id="diskSub">of 75 GB configured</div><div class="track"><span id="diskBar"></span></div></div>
<div class="card"><div class="label">Running containers</div><div class="value" id="containers">—</div><div class="hint" id="containerSub">Docker / Supabase</div><div class="track"><span id="conBar"></span></div></div>
</section>
<div class="cols">
<div class="card"><h2>CPU &amp; memory history</h2><svg id="chart" class="plot" viewBox="0 0 800 175" preserveAspectRatio="none" role="img" aria-label="Recent CPU and memory usage"></svg><p class="hint"><span style="color:#79b5fa">●</span> CPU &nbsp; <span style="color:#5de6b4">●</span> RAM &nbsp;·&nbsp; Last 60 minutes, collected while monitor runs</p></div>
<div class="card"><h2>Server &amp; traffic</h2><div class="info">
<div class="datum"><span class="hint">Upload / sec</span><b id="tx">—</b></div>
<div class="datum"><span class="hint">Download / sec</span><b id="rx">—</b></div>
<div class="datum"><span class="hint">Uptime</span><b id="uptime">—</b></div>
<div class="datum"><span class="hint">PostgreSQL size</span><b id="db">—</b></div>
</div><p class="hint" id="update" style="margin-top:18px">Waiting for first sample...</p></div>
</div>
<div class="card" style="margin-top:15px"><h2>Service resource usage</h2><div style="overflow:auto"><table><thead><tr><th>Container</th><th>State</th><th>CPU</th><th>Memory</th></tr></thead><tbody id="rows"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody></table></div></div>
<div class="foot">Read-only monitoring. Access is restricted to localhost on the VPS; no public monitoring endpoint, student data, environment values, or secrets are exposed. Refreshes every 10 seconds.</div>
</main><script>
"use strict";
function el(id){return document.getElementById(id)}
function number(x,d){return typeof x==="number"&&Number.isFinite(x)?x.toFixed(d):"—"}
function percent(id,value){var n=Math.max(0,Math.min(100,Number(value)||0));el(id).style.width=n+"%";el(id).style.background=n>90?"#fc8090":n>75?"#ffc977":"#5de6b4"}
function draw(data){var svg=el("chart");var h=(data.history||[]).slice(-360);var parts=[];
for(var k=0;k<=4;k++){var y=160-150*k/4;parts.push('<path d="M0 '+y+' H800" fill="none" stroke="#2b3b50" stroke-width="1"/>')}
function series(key,color){if(h.length<2)return;var points=h.map(function(x,i){var px=800*i/(h.length-1),py=160-150*Math.max(0,Math.min(100,Number(x[key])||0))/100;return px.toFixed(1)+","+py.toFixed(1)}).join(" ");parts.push('<polyline points="'+points+'" fill="none" stroke="'+color+'" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>')}
series("cpu","#79b5fa");series("ram","#5de6b4");svg.innerHTML=parts.join("")}
function update(x){el("online").textContent="● Connected · live";el("online").style.color="#5de6b4";var m=x.memory,d=x.disk;
el("cpu").textContent=number(x.cpu,1)+"%";el("cpuSub").textContent=x.cores+" logical cores · load "+x.load_1m;percent("cpuBar",x.cpu)
el("ram").textContent=number(m.used_gib,2)+" GB";el("ramSub").textContent="of "+number(m.total_gib,2)+" GB ("+number(m.percent,0)+"%)";percent("ramBar",m.percent)
el("disk").textContent=number(d.used_gib,1)+" GB";el("diskSub").textContent="of "+number(d.total_gib,1)+" GB ("+number(d.percent,0)+"%)";percent("diskBar",d.percent)
el("containers").textContent=x.docker.running===null?"—":x.docker.running;el("containerSub").textContent=x.docker.error?"Docker metrics temporarily unavailable":"Docker containers active";percent("conBar",x.docker.running===null?0:Math.min(100,x.docker.running*5))
el("tx").textContent=number(x.network.tx_mib_s,2)+" MiB";el("rx").textContent=number(x.network.rx_mib_s,2)+" MiB";el("uptime").textContent=Math.floor(x.uptime_seconds/86400)+"d "+Math.floor((x.uptime_seconds%86400)/3600)+"h";
el("db").textContent=x.database_bytes===null?"Not available":number(x.database_bytes/1048576,1)+" MiB";
el("update").textContent="Last sample: "+new Date(x.at).toLocaleTimeString()+" · 10-second refresh";
var rows=el("rows");rows.replaceChildren();if(!x.docker.services.length){var tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.textContent="No service statistics available";td.className="empty";tr.appendChild(td);rows.appendChild(tr)}
x.docker.services.forEach(function(s){var tr=document.createElement("tr");[s.name,s.status,s.cpu,s.memory].forEach(function(v,i){var td=document.createElement("td");td.textContent=v;if(i===1&&String(v).toLowerCase().includes("up"))td.style.color="#5de6b4";tr.appendChild(td)});rows.appendChild(tr)});
draw(x)}
async function refresh(){try{var res=await fetch("/api/metrics",{cache:"no-store"});if(!res.ok)throw Error("HTTP "+res.status);update(await res.json())}catch(e){el("online").textContent="● Connection lost";el("online").style.color="#fc8090";el("update").textContent="Reconnect when the SSH tunnel is available"}}
refresh();setInterval(refresh,10000);
</script></body></html>'''

def read_cpu():
    global PREV_CPU
    parts = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
    values = [int(x) for x in parts]
    total = sum(values)
    idle = values[3] + (values[4] if len(values)>4 else 0)
    previous = PREV_CPU
    PREV_CPU = (total, idle)
    if previous is None or total <= previous[0]:
        return 0.0
    return round(100.0*(1.0-(idle-previous[1])/(total-previous[0])),1)

def read_mem():
    text = Path("/proc/meminfo").read_text()
    d = {m.group(1):int(m.group(2))*1024 for m in re.finditer(r"^(\w+):\s+(\d+)\s+kB",text,re.M)}
    total = d["MemTotal"]
    used = total - d.get("MemAvailable",d.get("MemFree",0))
    return {"total_gib":round(total/1073741824,2),"used_gib":round(used/1073741824,2),"percent":round(100*used/total,1)}

def read_disk():
    v = shutil.disk_usage("/")
    return {"total_gib":round(v.total/1073741824,2),"used_gib":round(v.used/1073741824,2),"percent":round(100*v.used/v.total,1)}

def read_net():
    global PREV_NET
    rx = tx = 0
    for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
        iface, _, stats = line.partition(":")
        iface = iface.strip()
        if iface=="lo" or iface.startswith(("veth","docker","br-")):
            continue
        fields = stats.split()
        if len(fields)>=9:
            rx+=int(fields[0]);tx+=int(fields[8])
    now=time.monotonic()
    prev=PREV_NET
    PREV_NET=(now,rx,tx)
    if prev is None:
        return {"rx_mib_s":0.0,"tx_mib_s":0.0}
    dt=max(.1,now-prev[0])
    return {"rx_mib_s":round(max(0,rx-prev[1])/dt/1048576,3),
            "tx_mib_s":round(max(0,tx-prev[2])/dt/1048576,3)}

def docker_command(*args):
    return subprocess.run(["sudo","-n","/usr/bin/docker",*args],capture_output=True,
                          text=True,timeout=7,check=True).stdout

def docker_data():
    result={"running":None,"services":[],"error":False}
    try:
        listing=docker_command("ps","--format","{{.Names}}|{{.Status}}")
        stats=docker_command("stats","--no-stream","--format","{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}")
        statuses={}
        for line in listing.splitlines():
            name,_,status=line.partition("|")
            statuses[name]=status[:80]
        result["running"]=len(statuses)
        for line in stats.splitlines():
            p=line.split("|",2)
            if len(p)<3:
                continue
            name,cpu,mem=p
            if not (name.startswith(("supabase-","neis-"))):
                continue
            result["services"].append({"name":name[:80],"status":statuses.get(name,"Unknown"),
                                       "cpu":cpu[:20],"memory":mem[:55]})
        result["services"].sort(key=lambda x:x["name"])
    except (OSError,subprocess.SubprocessError):
        result["error"]=True
    return result

def database_size():
    now=time.monotonic()
    if now-DB_CACHE["at"]<60:
        return DB_CACHE["bytes"]
    DB_CACHE["at"]=now
    try:
        output=docker_command("exec","supabase-db","psql","-X","-U","postgres","-d","postgres",
                              "-Atqc","select pg_database_size(current_database())")
        n=int(output.strip())
        DB_CACHE["bytes"]=n if 0<n<10**15 else None
    except (OSError,ValueError,subprocess.SubprocessError):
        DB_CACHE["bytes"]=None
    return DB_CACHE["bytes"]

def sample():
    with LOCK:
        now=time.monotonic()
        if CACHE["payload"] is not None and now-CACHE["at"]<8:
            return CACHE["payload"]
        cpu=read_cpu()
        memory=read_mem()
        disk=read_disk()
        rx_tx=read_net()
        load=os.getloadavg()[0]
        uptime=float(Path("/proc/uptime").read_text().split()[0])
        docker=docker_data()
        db=database_size()
        utc=datetime.now(timezone.utc).isoformat()
        HISTORY.append({"at":utc,"cpu":cpu,"ram":memory["percent"]})
        payload={"at":utc,"cpu":cpu,"cores":os.cpu_count(),"memory":memory,"disk":disk,
                 "network":rx_tx,"load_1m":round(load,2),"uptime_seconds":uptime,
                 "docker":docker,"database_bytes":db,"history":list(HISTORY)}
        CACHE.update({"at":now,"payload":payload})
        return payload

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Loopback binding alone does not prevent hostile Host-header DNS rebinding.
        host=self.headers.get("Host","")
        if host not in (f"localhost:{PORT}",f"127.0.0.1:{PORT}"):
            self.send_error(403)
            return
        path=urlsplit(self.path).path
        if path=="/":
            body=HTML.encode("utf-8")
            content_type="text/html; charset=utf-8"
        elif path=="/health":
            body=b'{"service":"neis-private-monitor","ready":true}'
            content_type="application/json"
        elif path=="/api/metrics":
            try:
                body=json.dumps(sample(),separators=(",",":")).encode("utf-8")
            except Exception:
                self.send_error(503)
                return
            content_type="application/json"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store, max-age=0")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args):
        pass

if __name__=="__main__":
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    server.serve_forever(poll_interval=0.5)
