// Runs the built CLI (dist/glitchtip.js) as a child process with an isolated
// HOME and config file, so tests never touch the real ~/.config/glitchtip.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

const BIN = new URL('../../dist/glitchtip.js', import.meta.url).pathname;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Running {
  stdin: Writable;
  waitForStderr(pattern: RegExp): Promise<string>;
  done: Promise<RunResult>;
}

export interface StoredConfig {
  defaultProfile: string | null;
  profiles: Record<string, Record<string, unknown>>;
}

export interface Cli {
  configPath: string;
  start(args: string[], env?: Record<string, string>): Running;
  run(args: string[], options?: { env?: Record<string, string>; stdin?: string }): Promise<RunResult>;
  writeConfig(config: StoredConfig): void;
  readConfig(): StoredConfig;
  configMode(): number;
  configExists(): boolean;
}

const dirs: string[] = [];

export function cleanupCliDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function createCli(): Cli {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing. Run \`pnpm build\` first (\`pnpm test\` does).`);
  const dir = mkdtempSync(join(tmpdir(), 'glitchtip-test-'));
  dirs.push(dir);
  const configPath = join(dir, 'config.json');

  const start = (args: string[], env: Record<string, string> = {}): Running => {
    // Only PATH is inherited, so a developer's GLITCHTIP_* variables cannot leak in.
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { PATH: process.env.PATH ?? '', HOME: dir, GLITCHTIP_CONFIG: configPath, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});

    let stdout = '';
    let stderr = '';
    const watchers: { pattern: RegExp; resolve: (text: string) => void }[] = [];
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
      for (const watcher of [...watchers]) {
        const match = watcher.pattern.exec(stderr);
        if (match) {
          watchers.splice(watchers.indexOf(watcher), 1);
          watcher.resolve(match[0]);
        }
      }
    });

    const done = new Promise<RunResult>((resolve) => {
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    return {
      stdin: child.stdin,
      done,
      waitForStderr: (pattern) =>
        new Promise((resolve, reject) => {
          const match = pattern.exec(stderr);
          if (match) return resolve(match[0]);
          watchers.push({ pattern, resolve });
          void done.then(() => reject(new Error(`Process exited before stderr matched ${pattern}:\n${stderr}`)));
        }),
    };
  };

  return {
    configPath,
    start,
    run: async (args, { env, stdin = '' } = {}) => {
      const running = start(args, env);
      running.stdin.end(stdin);
      return running.done;
    },
    writeConfig: (config) => writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 }),
    readConfig: () => JSON.parse(readFileSync(configPath, 'utf8')) as StoredConfig,
    configMode: () => statSync(configPath).mode & 0o777,
    configExists: () => existsSync(configPath),
  };
}
