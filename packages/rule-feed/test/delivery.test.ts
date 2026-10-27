import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const configure = resolve('.github/scripts/configure-cloudflare.mjs');
const secrets = resolve('.github/scripts/apply-cloudflare-secrets.mjs');
const release = resolve('.github/scripts/check-release.mjs');
const baseEnvironment = { PATH: process.env.PATH };

describe('delivery configuration fails closed', () => {
  it('rejects missing production bindings before writing a config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flashguard-config-'));
    try {
      await mkdir(join(directory, 'apps/web'), { recursive: true });
      const original = JSON.stringify({
        vars: { ENVIRONMENT: 'development' },
        d1_databases: [{ binding: 'DB' }],
      });
      await writeFile(join(directory, 'apps/web/wrangler.jsonc'), original);
      expect(() =>
        execFileSync(process.execPath, [configure], {
          cwd: directory,
          env: baseEnvironment,
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(
        await readFile(join(directory, 'apps/web/wrangler.jsonc'), 'utf8'),
      ).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('generates production-mode bindings without local fixtures and rejects Turnstile test keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flashguard-config-'));
    try {
      await mkdir(join(directory, 'apps/web'), { recursive: true });
      await writeFile(
        join(directory, 'apps/web/wrangler.jsonc'),
        `{
          // Wrangler accepts comments and trailing commas.
          "vars": { "LOCAL_TURNSTILE_FIXTURE": "true", },
          "d1_databases": [{ "binding": "DB", }],
        }`,
      );
      const env = {
        ...baseEnvironment,
        PUBLIC_APP_ORIGIN: 'https://staging.example.com',
        CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
        D1_DATABASE_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        WORKER_NAME: 'flashguard-staging',
        TURNSTILE_SITE_KEY: 'synthetic-site-key-not-a-provider-key',
        TURNSTILE_HOSTNAMES: 'staging.example.com',
        MAIL_FROM: 'test@example.com',
        MODERATOR_USER_IDS: 'synthetic-maintainer',
      };
      execFileSync(process.execPath, [configure], {
        cwd: directory,
        env,
        stdio: 'pipe',
      });
      const config = JSON.parse(
        await readFile(join(directory, 'apps/web/wrangler.jsonc'), 'utf8'),
      );
      expect(config.vars.ENVIRONMENT).toBe('production');
      expect(config.vars.LOCAL_TURNSTILE_FIXTURE).toBeUndefined();
      expect(config.routes).toEqual([
        { pattern: 'staging.example.com', custom_domain: true },
      ]);
      expect(() =>
        execFileSync(process.execPath, [configure], {
          cwd: directory,
          env: { ...env, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' },
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(() =>
        execFileSync(process.execPath, [configure], {
          cwd: directory,
          env: {
            ...env,
            D1_DATABASE_ID: '00000000-0000-0000-0000-000000000001',
          },
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('validates all runtime secrets without spawning a remote operation', () => {
    expect(() =>
      execFileSync(process.execPath, [secrets, '--validate-only'], {
        env: baseEnvironment,
        stdio: 'pipe',
      }),
    ).toThrow();
    const value = 'synthetic-test-only-'.repeat(3);
    const output = execFileSync(
      process.execPath,
      [secrets, '--validate-only'],
      {
        env: {
          ...baseEnvironment,
          BETTER_AUTH_SECRET: value,
          SHARE_TOKEN_SECRET: value,
          TURNSTILE_SECRET_KEY: value,
          RESEND_API_KEY: value,
        },
        encoding: 'utf8',
      },
    );
    expect(output).toContain('present');
    expect(output).not.toContain(value);
  });
  it('rejects mismatched tags, missing real owners and incorrect built extension versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flashguard-release-'));
    try {
      await mkdir(join(directory, '.github'), { recursive: true });
      await mkdir(join(directory, 'apps/chrome-extension/dist'), {
        recursive: true,
      });
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ version: '0.1.0' }),
      );
      await writeFile(
        join(directory, '.github/CODEOWNERS'),
        '# No owners yet\n',
      );
      const env = { ...baseEnvironment, GITHUB_REF_NAME: 'v0.1.0' };
      expect(() =>
        execFileSync(process.execPath, [release], {
          cwd: directory,
          env,
          stdio: 'pipe',
        }),
      ).toThrow();
      await writeFile(
        join(directory, '.github/CODEOWNERS'),
        '* @synthetic-test-owner\n',
      );
      expect(() =>
        execFileSync(process.execPath, [release], {
          cwd: directory,
          env: { ...env, GITHUB_REF_NAME: 'v9.9.9' },
          stdio: 'pipe',
        }),
      ).toThrow();
      await writeFile(
        join(directory, 'apps/chrome-extension/dist/manifest.json'),
        JSON.stringify({ version: '0.0.1' }),
      );
      expect(() =>
        execFileSync(process.execPath, [release, '--built'], {
          cwd: directory,
          env,
          stdio: 'pipe',
        }),
      ).toThrow();
      await writeFile(
        join(directory, 'apps/chrome-extension/dist/manifest.json'),
        JSON.stringify({ version: '0.1.0' }),
      );
      execFileSync(process.execPath, [release, '--built'], {
        cwd: directory,
        env,
        stdio: 'pipe',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
