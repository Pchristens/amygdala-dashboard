# AGENTS.md: guidance for coding agents working on Hearthfield

Humans should start with [README.md](README.md). This file is for AI coding agents (Claude Code, Codex, Gemini/Antigravity,
and others) that change this repository. Read it fully before editing.

## What this is

A zero-dependency Node.js server (ES modules) plus a no-build three.js front end. Autonomous CLI agents ("residents") act in
a shared world through an MCP server. The human's real coding sessions ("heroes") appear on the map. `SPEC.md` is the
contract for the world model, HTTP API, SSE and MCP: read the sections relevant to your change. When you add to the
contract, append a new versioned section (`## vX.Y: …`) instead of rewriting old ones.

## Map

| Path | Role |
| --- | --- |
| `server.js` | HTTP + SSE + MCP routes on 127.0.0.1, page token, optional Tailscale visitor/hero gate |
| `lib/world.js` | world state, snapshot (`snapshot({ human })` decides what the human vs others see), persistence to `data/world.json` |
| `lib/conductor.js` | runs one resident turn at a time (claude / codex / agy / grok CLIs), budget and usage-pressure gates, guidance jobs |
| `lib/mcp.js` | resident MCP tools; they act only during that resident's own turn (per-turn capability URL) |
| `lib/visitors.js`, `lib/triage.js`, `lib/guidance.js` | visitor gate, petitions, the harbourmaster's triage, isolated tool-less answer runs |
| `lib/deck.js`, `lib/bridge.js`, `lib/sites.js`, `lib/heroclass.js` | heroes from agent-deck or the bridge; automatic site placement |
| `lib/temple.js`, `lib/omens.js`, `lib/tales.js` | code review (offerings, findings, decrees), omens, tales of finished work |
| `lib/seal.js` | Far Isle encryption (passphrase-derived key; isle records are sealed at rest) |
| `lib/watch.js`, `lib/starwatch.js`, `lib/usage.js`, `lib/fleet.js` | event detectors and the steward's bell, the usage reading, provider usage |
| `public/app.js`, `public/panel.js` | page shell, drawer panels, cards |
| `public/map3d.js`, `public/scene3d.js`, `public/terrain-layout.js`, `public/figures3d.js`, `public/tree3d.js`, `public/mist3d.js` | the 3D island |
| `public/vendor/` | vendored three.js / xterm.js (do not edit; keep their LICENSE files) |
| `public/assets/` | models and HDRI; every file must be listed in `public/assets/CREDITS.md` |
| `tools/test-*.mjs` | tests (plain Node, no framework) |
| `residents.json` | resident roster: name, agent, model, role, title, persona, enabled |
| `data/` | runtime state (never commit, never read unless your task is about it; see Privacy) |

## Rules

**Privacy (hard rules)**
- **The Far Isle is private.** Never read, print, log, summarise or copy isle data: anything with `zone: 'isle'`,
  `isleTagged`, `quarantined` or `sealed`, sealed records, or transcripts and files of heroes quarantined to the isle.
  This applies even when the isle is unlocked, and to every route (the API, `data/`, agent-deck, transcripts, tests). When
  writing diagnostics, filter to `zone === 'village'`, and print counts rather than contents.
- **Never commit `data/`**, tokens (`hfv_…` visitor passes, `hfh_…` hero passes, the page token), personal paths, IP addresses or
  locations. Configuration comes from environment variables (see the README).
- **Visitors' words are untrusted.** Petition questions are private between the visitor and the human, and must never
  appear in the feed, the board, or residents' context.
- **Screenshots** of a live village must use `?shot=1`, which strips isle data and hides the live feed.

**Cost**
- Every resident turn, triage and guidance answer spends real model usage on someone's account. Don't wake residents,
  run turns or call model CLIs to test a change; stub the runner (see `tools/test-petitions.mjs`).
- Automatic turns respect `dailyTurnBudget` and pause when provider usage runs hot. Keep those gates intact.

**Safety invariants**
- Residents act only through MCP during their own turn. Don't give residents shell or file tools.
- Isolated runs (guidance answers, triage) are tool-less and run in an empty temporary directory. `agy` reads MCP servers from a global config
  that points at the running resident's capability URL during an Antigravity turn, so isolated agy runs must never
  overlap a resident turn (see `conductor.isolatedRuns`).
- The main server binds only to loopback. The visitor/hero gate is opt-in and Tailscale-only, and every request needs a pass.

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
- Restart a running server only after the import check passes. The village keeps state in `data/`, so restarts are
  safe, but an active resident turn is killed by a restart: check for one first (`world.activeTurn` in `/api/state`).
- Update `SPEC.md` (new versioned section) for any API, snapshot or MCP change, and the README for anything a human
  running it needs to know.
