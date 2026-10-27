import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const required = (/** @type {string} */ name) => {
  if (!process.env[name])
    throw new Error(`Missing deployment configuration: ${name}`);
  return process.env[name];
};
const origin = new URL(required('PUBLIC_APP_ORIGIN'));
if (
  origin.protocol !== 'https:' ||
  origin.origin !== required('PUBLIC_APP_ORIGIN') ||
  ['localhost', '127.0.0.1'].includes(origin.hostname)
)
  throw new Error('Deployment needs an exact public HTTPS origin');
const account = required('CLOUDFLARE_ACCOUNT_ID');
const databaseId = required('D1_DATABASE_ID');
if (!/^[a-f0-9]{32}$/.test(account))
  throw new Error('Invalid Cloudflare account ID');
if (
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId) ||
  /^0{8}-/.test(databaseId)
)
  throw new Error('A provisioned D1 database ID is required');
const workerName = required('WORKER_NAME');
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName))
  throw new Error('Invalid Worker name');
const siteKey = required('TURNSTILE_SITE_KEY');
if (/^[123]x0{10,}/.test(siteKey))
  throw new Error('Cloudflare Turnstile test keys cannot be deployed');
const hostnames = required('TURNSTILE_HOSTNAMES');
if (
  !hostnames
    .split(',')
    .map((value) => value.trim())
    .includes(origin.hostname)
)
  throw new Error(
    'Turnstile hostname allowlist does not include the deployed origin',
  );
const configPath = 'apps/web/wrangler.jsonc';
const parsed = ts.parseConfigFileTextToJson(
  configPath,
  await readFile(configPath, 'utf8'),
);
if (parsed.error) throw new Error('Invalid Wrangler JSONC configuration');
const config = parsed.config;
config.name = workerName;
config.account_id = account;
config.workers_dev = false;
config.routes = [{ pattern: origin.hostname, custom_domain: true }];
config.limits = { cpu_ms: 100 };
config.vars = {
  ENVIRONMENT: 'production',
  PUBLIC_APP_ORIGIN: origin.origin,
  TURNSTILE_SITE_KEY: siteKey,
  TURNSTILE_HOSTNAMES: hostnames,
  MAIL_FROM: required('MAIL_FROM'),
  MODERATOR_USER_IDS: required('MODERATOR_USER_IDS'),
};
config.d1_databases[0].database_id = databaseId;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  'Configured production-mode bindings; local fixtures are disabled.',
);
