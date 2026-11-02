import assert from 'node:assert/strict';
import { deployPush } from '../lib/audit.js';
for (const cmd of ['git push -uf origin HEAD:main', 'git push -q origin main; git -c color.ui=false push --force origin main', 'git push -q origin main && git -C x push -f origin main', 'git push -q origin main\ngit push --force origin main', 'git push -q origin main $EXTRA', 'echo $X; git push -q origin main']) assert.equal(deployPush(cmd), false, cmd);
for (const cmd of ['git push -q origin main', 'cd repo && git push -q origin main; echo done']) assert.equal(deployPush(cmd), true, cmd);
console.log('PASS: deploy push coverage excludes force pushes, additional pushes and dollar expansion');
