#!/usr/bin/env node
// Launcher: runs the TypeScript CLI through the tsx loader.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', join(root, 'src/cli/index.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 0);
