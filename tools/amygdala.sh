#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state=${XDG_STATE_HOME:-"$HOME/.local/state"}/amygdala
mkdir -p "$state"
log=$state/amygdala.log
pidfile=$state/amygdala.pid
base=http://127.0.0.1:${HEARTHFIELD_PORT:-8790}
token() { curl -fsS "$base/" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const m=s.match(/<meta name="hf-token" content="([^"]+)">/);if(!m)process.exit(1);console.log(m[1])})'; }
owned() { [ -f "$pidfile" ] && pid=$(cat "$pidfile") && case "$pid" in *[!0-9]*|'') return 1;; esac && ps -p "$pid" -o command= | REPO="$repo/server.js" node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.exit(s.includes(process.env.REPO)?0:1))'; }
start() {
  if token >/dev/null 2>&1; then return; fi
  if owned; then echo 'Server is running but not responding; inspect logs.' >&2; exit 1; fi
  (cd "$repo"; nohup node "$repo/server.js" >>"$log" 2>&1 </dev/null & echo $! >"$pidfile")
  i=0; until token >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 40 ] || { echo 'Startup failed; inspect logs.' >&2; exit 1; }; sleep .25; done
}
case ${1:-open} in
  start) start;;
  open) start; if [ "$(uname)" = Darwin ]; then open "$base"; else xdg-open "$base"; fi;;
  stop) if owned; then kill "$pid"; rm -f "$pidfile"; else echo 'No owned Amygdala process found.'; fi;;
  status) if token >/dev/null 2>&1; then echo 'Amygdala is running.'; else echo 'Amygdala is not responding.'; fi;;
  logs) tail -n 60 -f "$log";;
  pass) [ "$#" -ge 2 ] || { echo 'Usage: amygdala pass <name> [label] [hours]' >&2; exit 1; }
    page_token=$(token)
    body=$(node -e 'console.log(JSON.stringify({name:process.argv[1],label:process.argv[2],hours:Number(process.argv[3])}))' "$2" "${3:-}" "${4:-24}")
    curl -fsS -H "x-hearthfield-token: $page_token" -H 'Content-Type: application/json' --data "$body" "$base/api/visitors/pass" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.token)throw Error(r.error||"Pass refused");console.log(r.token)})';;
  *) echo 'Commands: open, start, stop, status, logs, pass' >&2; exit 1;;
esac
