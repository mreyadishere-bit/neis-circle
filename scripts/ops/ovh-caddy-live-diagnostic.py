#!/usr/bin/env python3
"""Read-only Caddy availability diagnostics. Never changes containers or config."""
import json, re, subprocess, sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
DOCKER=["sudo","-n","/usr/bin/docker"]

def run(label, argv, timeout=20):
    try:
        p=subprocess.run(argv,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
        out=p.stdout.strip()
        err=p.stderr.strip()
        if label=="CADDY_INSPECT" and p.returncode==0:
            data=json.loads(out)
            item=data[0]
            state=item.get("State",{})
            ports=item.get("NetworkSettings",{}).get("Ports",{})
            bindings={k:[x.get("HostIp","")+":"+x.get("HostPort","") for x in (v or [])]
                      for k,v in ports.items()}
            print("CADDY_STATE="+str(state.get("Status","unknown")))
            print("CADDY_RESTARTS="+str(item.get("RestartCount",0)))
            print("CADDY_EXIT_CODE="+str(state.get("ExitCode","unknown")))
            print("CADDY_PORT_BINDINGS="+json.dumps(bindings,sort_keys=True))
        elif label=="CADDY_PORTS":
            print("CADDY_PORTS="+(out.replace("\n","; ") if out else "NONE"))
        elif label=="LISTENERS":
            safe=[]
            for line in out.splitlines():
                if re.search(r":(?:80|443)\s",line):
                    safe.append(line.strip()[:180])
            print("HOST_LISTENERS="+("; ".join(safe) if safe else "NONE"))
        elif label=="DNS":
            ips=sorted(set(line.split()[0] for line in out.splitlines() if line.strip()))
            print("PUBLIC_DNS_A="+(",".join(ips) if ips else "NONE"))
        elif label.startswith("LOOPBACK_"):
            value=out or err
            if p.returncode==0:
                print(label+"_RESULT="+(value[:100] if value else "OK"))
            else:
                hint="CONNECTION_REFUSED" if "Connection refused" in err else ("TIMEOUT" if "timed out" in err.lower() else "FAILED")
                print(label+"_RESULT="+hint)
        elif label=="CADDY_VALIDATE":
            print("CADDY_CONFIG_VALIDATE="+("PASS" if p.returncode==0 else "FAIL"))
            if p.returncode:
                print("CADDY_CONFIG_VALIDATE_HINT="+(err.splitlines()[-1][:180] if err else "UNKNOWN"))
        elif label=="CADDY_LOG_HINTS":
            lines=[x.lower() for x in out.splitlines()]
            hints=[]
            for term,code in (("address already in use","PORT_CONFLICT"),("permission denied","PERMISSION"),
                              ("certificate","CERTIFICATE"),("error","ERROR"),("failed","FAILED"),
                              ("loading initial config","CONFIG_LOADED")):
                if any(term in line for line in lines):hints.append(code)
            print("CADDY_LOG_HINTS="+(",".join(sorted(set(hints))) if hints else "NO_MATCH"))
        elif label=="COMPOSE_PS":
            print("CADDY_COMPOSE_PS="+(out.replace("\n","; ")[:500] if out else "EMPTY"))
        else:
            print(label+"_EXIT="+str(p.returncode))
    except FileNotFoundError:
        print(label+"_RESULT=COMMAND_MISSING")
    except subprocess.TimeoutExpired:
        print(label+"_RESULT=TIMEOUT")
    except Exception as exc:
        print(label+"_RESULT=DIAGNOSTIC_ERROR_"+type(exc).__name__)

def main():
    if not ROOT.is_dir():
        print("DIAGNOSTIC=ROOT_MISSING");return 1
    files=("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
           "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
    compose=DOCKER+["compose"]+[v for f in files for v in ("-f",str(ROOT/f))]
    run("CADDY_INSPECT",DOCKER+["inspect","supabase-caddy"])
    run("CADDY_PORTS",DOCKER+["port","supabase-caddy"])
    run("LISTENERS",["sudo","-n","ss","-ltnH"])
    run("DNS",["getent","ahostsv4","neiscircle.site"])
    run("LOOPBACK_HTTP",["curl","-sS","-o","/dev/null","-w","%{http_code}|%{remote_ip}",
        "--connect-timeout","5","--max-time","12","http://127.0.0.1:80/","-H","Host: neiscircle.site"],timeout=15)
    run("LOOPBACK_HTTPS",["curl","-k","-sS","-o","/dev/null","-w","%{http_code}|%{remote_ip}",
        "--connect-timeout","5","--max-time","12","--resolve","neiscircle.site:443:127.0.0.1",
        "https://neiscircle.site/"],timeout=15)
    run("CADDY_VALIDATE",DOCKER+["exec","supabase-caddy","caddy","validate","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"])
    run("CADDY_LOG_HINTS",DOCKER+["logs","--since","15m","--tail","100","supabase-caddy"],timeout=20)
    run("COMPOSE_PS",compose+["ps","caddy"],timeout=30)
    print("CADDY_DIAGNOSTIC=COMPLETE_READ_ONLY")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
