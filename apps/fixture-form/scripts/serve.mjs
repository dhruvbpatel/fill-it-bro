#!/usr/bin/env node
import { spawn } from 'node:child_process';

const port = process.env.FIXTURE_PORT ?? '4300';
const child = spawn('ng', ['serve', '--port', port, '--host', '0.0.0.0'], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
