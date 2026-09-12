#!/usr/bin/env node
import { spawn } from 'node:child_process';

const port = process.env.FIXTURE_PORT ?? '4300';
const host = process.env.FIXTURE_HOST ?? '127.0.0.1';
const child = spawn('ng', ['serve', '--port', port, '--host', host], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
