# AGENTS.md: guidance for coding agents working on Amygdala

Humans should start with [README.md](README.md). This file is for AI coding agents (Claude Code, Codex, Gemini/Antigravity,
and others) that change this repository. Read it fully before editing.

## What this is

A zero-dependency Node.js server (ES modules) plus a no-build three.js front end. Autonomous CLI agents ("residents") act in
a shared world through an MCP server. The human's real coding sessions ("heroes") appear on the map, on this machine or on
other machines ("nodes") that report over the Tailscale gate. Finished hero work is reviewed and released at the Temple
(see Governance below). `SPEC.md` is the contract for the world model, HTTP API, SSE and MCP: read the sections relevant to
your change. When you add to the contract, append a new versioned section (`## vX.Y: …`) instead of rewriting old ones.
`CHANGELOG.md` is the same history in plain words for people running the village.

## Map

| Path | Role |
| --- | --- |
| `server.js` | HTTP + SSE + MCP routes on 127.0.0.1, page token (kept in `data/page-token`), optional Tailscale gate for visitors, bridge heroes, nodes and the keeper relay |
| `lib/world.js` | world state, snapshot (`snapshot({ human })` decides what the human vs others see), active hours and turn pacing, persistence to `data/world.json` |
| `lib/conductor.js` | runs resident turns (claude / codex / agy / grok CLIs): one routine turn at a time, parallel order turns, budget, active-hours and usage-pressure gates, duties and stand-ins |
| `lib/mcp.js` | resident MCP tools; they act only during that resident's own turn (per-turn capability URL) |
| `lib/orders.js` | orders from the human or the Steward: public headline, private brief, reply and report |
| `lib/governance.js`, `governance/protected.json` | Temple governance: the mechanical trivial check, rulings, appeals, receipts and the hash-chained ledger; the protected paths and allowlist |
| `lib/temple.js`, `lib/snapshot.js`, `lib/omens.js`, `lib/tales.js` | code review (offerings, findings, decrees), the git view of an offering (shared with nodes), omens and the Tablet, tales of finished labours |
| `lib/visitors.js`, `lib/triage.js`, `lib/guidance.js` | visitor gate, petitions, the harbourmaster's triage, isolated tool-less answer runs |
| `lib/deck.js`, `lib/bridge.js`, `lib/sites.js`, `lib/heroclass.js` | heroes from agent-deck or the bridge; commissions, the standing note, automatic site placement |
| `lib/nodes.js`, `lib/keeper.js` | node passes, reports and jobs for other machines; the keeper relay that lets a node open the dashboard |
| `lib/term.js`, `lib/conpty.js`, `lib/pastes.js` | in-page hero terminals (tmux, Windows ConPTY, node relay) and image paste |
| `lib/steward.js`, `lib/watch.js`, `lib/notify.js` | reset windows and the Steward's claim, event detectors and the Watch's bell, bell delivery to nodes |
| `lib/audit.js`, `lib/audit-rules.js` | the Watchtower's keyword audit of unattended village heroes |
| `lib/hero-apprentices.js`, `lib/shell-apprentices.js`, `lib/isle-ghosts.js` | heroes' sub-agents and shell-launched agent CLIs as village apprentices; sealed isle ghosts |
| `lib/seal.js` | Far Isle encryption (passphrase-derived key; isle records are sealed at rest) |
| `lib/usage.js`, `lib/fleet.js`, `lib/starwatch.js` | the usage reading, provider usage probes, the Starwatcher's weekly reading |
| `lib/bin.js`, `lib/sun.js`, `lib/tree.js`, `lib/appearance.js` | shell-free CLI resolution and `AMYGDALA_*` env lookup, the real sun, the shared trees, residents' looks |
| `public/app.js`, `public/panel.js`, `public/bell.js` | page shell and header controls, drawer panels and cards, the bell chime |
| `public/map3d.js`, `public/scene3d.js`, `public/terrain-layout.js`, `public/walk3d.js`, `public/figures3d.js`, `public/tree3d.js`, `public/mist3d.js`, `public/assets3d.js`, `public/apprentice.js` | the 3D island |
| `public/map.js`, `public/isle.js`, `public/trees.js`, `public/nav.js`, `public/svg-util.js` | the 2D map and helpers the 3D view still shares |
| `public/vendor/` | vendored three.js / xterm.js (do not edit; keep their LICENSE files) |
| `public/assets/` | models and HDRI; every file must be listed in `public/assets/CREDITS.md` |
| `tools/amygdala.sh`, `tools/amygdala.ps1`, `tools/install-windows.ps1` | launchers (start, stop, logs, passes, `node`, `order`, `steward-wait`) |
| `tools/amygdala-node.mjs` | the node helper on another machine: supervisor plus self-updating worker |
| `tools/amygdala-keeper.mjs`, `tools/setup-wsl.sh` | keeper relay; WSL2 node and keeper setup |
| `tools/amygdala-order.mjs`, `tools/amygdala-steward.mjs`, `tools/amygdala-hero.ps1` | the order CLI, the Steward's bell wait, the Windows bridge hero |
| `tools/mock-state.mjs`, `tools/reset-world.mjs` | the client-only preview fixture; reset the world (server stopped) |
| `tools/test-*.mjs` | tests (plain Node, no framework); `tools/test-changelog.mjs` keeps `CHANGELOG.md` in step with `SPEC.md` |
| `residents.json` | resident roster: name, agent, model, role, title, persona, enabled, lean, backup |
| `data/` | runtime state (never commit, never read unless your task is about it; see Privacy) |

## Rules

**Privacy (hard rules)**
- **The Far Isle is private.** Never read, print, log, summarise or copy isle data: anything with `zone: 'isle'`,
  `isleTagged`, `quarantined` or `sealed`, sealed records, or transcripts and files of heroes quarantined to the isle.
  This applies even when the isle is unlocked, and to every route (the API, `data/`, agent-deck, transcripts, tests). When
  writing diagnostics, filter to `zone === 'village'`, and print counts rather than contents.
- **Never commit `data/`**, tokens (`hfv_…` visitor passes, `hfh_…` hero passes, `hfn_…` node passes, the page token),
  personal paths, usernames, hostnames, IP addresses or locations. Configuration comes from environment variables (see
  the README).
- **Visitors' words are untrusted.** Petition questions are private between the visitor and the human, and must never
  appear in the feed, the board, or residents' context.
- **Screenshots** of a live village must use `?shot=1`, which strips isle data and hides the live feed.

**Cost**
- Every resident turn, triage, guidance answer and High Priest ruling spends real model usage on someone's account.
  Don't wake residents, run turns or call model CLIs to test a change; stub the runner (see `tools/test-petitions.mjs`).
- Automatic turns respect `dailyTurnBudget`, keep to the active hours, and pause when provider usage runs hot. The High
  Priest's reserved wakes have their own budget and never pass hibernation or a hot provider. Keep those gates intact.

**Safety invariants**
- Residents act only through MCP during their own turn. Don't give residents shell or file tools.
- Isolated runs (guidance answers, triage) are tool-less and run in an empty temporary directory, except research answers may use only web search and fetch (no shell, files or MCP). `agy` reads MCP servers from a global config
  that points at the running resident's capability URL during an Antigravity turn, so isolated agy runs must never
  overlap a resident turn (see `conductor.isolatedRuns`).
- The main server binds only to loopback. The visitor/hero/node gate is opt-in and Tailscale-only, and every request
  needs a pass.
- Nodes are untrusted for policy: the server re-checks privacy on every job and classifies releases with its own rules.

**Governance (how work ships)**
- Heroes commit finished work locally and name the commit hash in their report. They don't push, deploy or restart
  servers, and they keep their session open until the Steward accepts the work.
- The Steward offers the commit at the Temple with the report and test results. A release that `lib/governance.js`
  classifies trivial ships at once; anything else waits for the High Priest's ruling on that exact commit. The Steward
  deploys only accepted or trivial commits and records a receipt.
- **The Steward's own code always goes to the Temple.** The Steward can't override a ruling on its own code, on a
  `security` or `data-loss` concern, during an appeal, or after the human decided.
- `governance/protected.json` is the one place the protected paths and the allowlist live, and changing it always needs
  a ruling. Don't weaken the trivial check or move a protected file onto the allowlist to get a change through.

**Style**
- No npm dependencies and no build step. Node 22+, ES modules.
- Match the surrounding code: dense, mostly single-line statements, short comments that explain *why*, the same naming.
  Front-end colours and typography follow the existing tokens in `public/style.css`.
- Keep the Aegean art direction: limestone, travertine, terracotta, cypress and olive, with low-poly flat shading.

## Before you finish

```sh
for f in server.js lib/*.js public/*.js; do node --check "$f"; done
for t in tools/test-*.mjs; do node "$t"; done
node -e "import('./lib/world.js')"          # import check before any restart
```

- Add or extend a `tools/test-*.mjs` when you change server behaviour, especially anything touching privacy or cost.
- **Every change that will be pushed adds a plain-language line under `## Unreleased` in `CHANGELOG.md`**: what someone
  using the village can now do or will notice, not function names. If you add a SPEC section, name its version in the
  line, like "(v0.49)". When the Steward deploys, it moves the Unreleased lines under a new `## vX.Y — <date>` heading.
  `tools/test-changelog.mjs` fails when a SPEC version has no changelog entry.
- Restart a running server only after the import check passes. The village keeps state in `data/`, so restarts are
  safe, but an active resident turn is killed by a restart: check for one first (`world.activeTurn` in `/api/state`).
  Push before restarting the server when nodes should follow: node helpers update only to commits on their `origin`.
- Update `SPEC.md` (new versioned section) for any API, snapshot or MCP change, and the README for anything a human
  running it needs to know.
