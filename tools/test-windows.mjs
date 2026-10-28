import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { command, bin, buildPath, hostOs, refreshAuth } from '../lib/bin.js';
import { Bridge } from '../lib/bridge.js';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-windows-'));
let w;
try {
  const entry = path.join(dir, 'node_modules', 'fake', 'bin', 'x.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, '');
  fs.writeFileSync(path.join(dir, 'node.exe'), '');
  fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n'); // npm's extensionless sh shim must never win on Windows
  fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\fake\\bin\\x.js" %*\r\n');
  const options = { platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT' } };
  const args = ['prompt & whoami | echo %PATH%', '"quoted"'];
  assert.deepEqual(command('codex', args, options), { file: path.join(dir, 'node.exe'), args: [entry, ...args] });
  fs.writeFileSync(path.join(dir, 'unsafe.bat'), 'echo %*');
  assert.throws(() => command('unsafe', args, options), /shell fallback is disabled/);
  assert.throws(() => bin('absent', options), /not found/);
  assert.equal(buildPath({ platform: 'win32', env: { PATH: 'C:\\tools;D:\\bin;C:\\tools' } }), 'C:\\tools;D:\\bin');
  assert.equal(hostOs('darwin'), 'macos'); assert.equal(hostOs('win32'), 'windows'); assert.equal(hostOs('linux'), 'linux');
  const b = new Bridge({ s: {}, seal: { locked: false }, refreshWorkers() {} });
  const pass = { id: 'test', name: 'Hero', zone: 'village', inbox: [] };
  assert.throws(() => b.report(pass, { os: 'win32' }), /os must/);
  b.report(pass, { os: 'windows' }); assert.equal(b.live.get('test').os, 'windows');
  b.report(pass, {}); assert.equal(b.live.get('test').os, null);
  const source = path.join(dir, 'source'), target = path.join(dir, 'target');
  fs.writeFileSync(source, 'first'); refreshAuth(source, target, 'win32'); assert.equal(fs.readFileSync(target, 'utf8'), 'first');
  fs.unlinkSync(target); fs.writeFileSync(target, 'old'); fs.utimesSync(target, new Date(0), new Date(0)); refreshAuth(source, target, 'win32'); assert.equal(fs.readFileSync(target, 'utf8'), 'first');
  w = new World(dir, [], path.join(dir, 'residents.json'));
  assert.equal(w.snapshot().world.hostOs, hostOs());
  console.log('PASS: Windows shim resolution, shell refusal, PATH, OS validation, snapshot and auth refresh');
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
