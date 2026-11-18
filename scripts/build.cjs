'use strict';

const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const project = resolve(__dirname, '..');
const out = resolve(process.argv[2] || resolve(project, 'dist'));
const assets = ['index.html', 'app.js', 'style.css', 'art.svg'];

execFileSync(process.execPath, ['--check', resolve(project, 'web/app.js')], { stdio: 'inherit' });
mkdirSync(out, { recursive: true });
for (const asset of assets) copyFileSync(resolve(project, 'web', asset), resolve(out, asset));
