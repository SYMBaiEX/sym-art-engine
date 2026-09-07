import { chmodSync, cpSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.platform === 'win32' ? 'bun.exe' : 'bun',
  ['x', 'tsc', '--project', 'tsconfig.build.json'],
  { stdio: 'inherit' },
);

if (result.status !== 0) process.exit(result.status ?? 1);

if (existsSync('dist/preview/public')) rmSync('dist/preview/public', { recursive: true });
cpSync('src/preview/public', 'dist/preview/public', { recursive: true });
chmodSync('dist/cli/index.js', 0o755);
