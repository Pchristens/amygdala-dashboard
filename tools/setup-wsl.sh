#!/usr/bin/env bash
# Set up an Amygdala agent-deck node inside WSL2 Ubuntu on a Windows server machine, so heroes run in tmux there:
# attach from any dashboard, close the client, and the work keeps going. Run it inside Ubuntu as your normal user.
# Idempotent; rerun to update. Uses only vendor installers. Logins and the node pass stay with the human.
#   bash tools/setup-wsl.sh            # install/update everything
#   AMYGDALA_SERVER=http://<gate>:8795 bash tools/setup-wsl.sh service   # then install the node as a user service
set -euo pipefail
BIN=$HOME/.local/bin REPO=${AMYGDALA_REPO:-$HOME/amygdala} CONF=$HOME/.config/amygdala
mkdir -p "$BIN" "$CONF"; chmod 700 "$CONF"
export PATH="$BIN:$PATH"
say() { printf '\n== %s\n' "$*"; }
# Vendor install scripts are saved first so a truncated download never runs half a script.
vendor() { local url=$1 f; f=$(mktemp); curl -fsSL "$url" -o "$f"; bash "$f" "${@:2}"; rm -f "$f"; }

service() {
  : "${AMYGDALA_SERVER:?Set AMYGDALA_SERVER to the Tailscale gate URL of the server}"
  [ -s "$CONF/node.pass" ] || { echo "Save the node pass in $CONF/node.pass first (chmod 600)." >&2; exit 1; }
  [ "$(ps -p 1 -o comm=)" = systemd ] || { echo 'systemd is off: add "[boot]\nsystemd=true" to /etc/wsl.conf, then run wsl --shutdown.' >&2; exit 1; }
  chmod 600 "$CONF/node.pass"; printf 'AMYGDALA_SERVER=%s\n' "$AMYGDALA_SERVER" >"$CONF/node.env"
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/amygdala-node.service" <<EOF
[Unit]
Description=Amygdala agent-deck node (relays this machine's heroes to the server)
After=network-online.target

[Service]
EnvironmentFile=$CONF/node.env
Environment=PATH=$BIN:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$REPO
ExecStart=$BIN/node $REPO/tools/amygdala-node.mjs --server \${AMYGDALA_SERVER} --pass-file $CONF/node.pass
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  # Lingering keeps user services (and their tmux heroes) alive without an open terminal.
  sudo loginctl enable-linger "$USER"
  systemctl --user daemon-reload; systemctl --user enable --now amygdala-node.service
  systemctl --user --no-pager status amygdala-node.service | head -5
}
[ "${1:-}" = service ] && { service; exit; }

say 'System packages (tmux, python3 for the terminal bridge, git)'
sudo apt-get update -qq && sudo apt-get install -y -qq tmux python3 git curl ca-certificates xz-utils >/dev/null

say 'Node.js 24 LTS from nodejs.org (checksum verified)'
arch=$(uname -m); case $arch in x86_64) arch=x64;; aarch64) arch=arm64;; esac
sums=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt); file=$(grep -o "node-v[0-9.]*-linux-$arch.tar.xz" <<<"$sums" | head -1)
if [ "$("$BIN/node" -v 2>/dev/null || true)" != "$(sed -E 's/node-(v[0-9.]+)-.*/\1/' <<<"$file")" ]; then
  tmp=$(mktemp -d); curl -fsSL "https://nodejs.org/dist/latest-v24.x/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" <<<"$sums" | sha256sum -c --quiet)
  rm -rf "$HOME/.local/node"; mkdir -p "$HOME/.local/node"; tar -xJf "$tmp/$file" -C "$HOME/.local/node" --strip-components=1; rm -rf "$tmp"
  for b in node npm npx; do ln -sf "$HOME/.local/node/bin/$b" "$BIN/$b"; done
fi
npm config set prefix "$HOME/.local" >/dev/null
grep -q 'HOME/.local/bin' "$HOME/.profile" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.profile"
node -v

say 'agent-deck (official installer)'; vendor https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/install.sh
say 'Claude Code (official installer)'; vendor https://claude.ai/install.sh
say 'Codex CLI (npm @openai/codex)'; npm install -g @openai/codex >/dev/null
say 'Antigravity CLI (official installer)'; vendor https://antigravity.google/cli/install.sh || true
say 'Grok CLI (official installer)'; vendor https://x.ai/cli/install.sh || true

say "Amygdala checkout at $REPO"
if [ -d "$REPO/.git" ]; then git -C "$REPO" pull --ff-only; else git clone https://github.com/Pchristens/amygdala-dashboard.git "$REPO"; fi

say 'Installed'
version() { command -v "$1" >/dev/null || { echo MISSING; return; }; { "$1" --version 2>/dev/null || "$1" -V 2>/dev/null; } | head -1; }
for c in node tmux python3 agent-deck claude codex agy grok; do printf '%-11s %s\n' "$c" "$(version "$c")"; done
cat <<EOF

Next (the human): log in to each CLI here (claude, codex login, agy, grok); save this machine's node pass in
$CONF/node.pass; then: AMYGDALA_SERVER=http://<gate>:8795 bash $REPO/tools/setup-wsl.sh service
EOF
