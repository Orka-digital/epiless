import { DatabaseSync } from 'node:sqlite';
import {
  mkdtemp,
  readdir,
  readFile,
  mkdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { exampleReport } from '../apps/web/src/lib/example-report.ts';
import { auditReportSchema, stableJson } from '../packages/core/src/index.ts';

// Offline SQLite/storage benchmark. Cloudflare Worker CPU/rows/facture need hosted measurements.
const count = Number(process.env.BENCHMARK_REPORTS || 10000);
if (!Number.isInteger(count) || count < 100 || count > 100000)
  throw new Error('BENCHMARK_REPORTS must be 100..100000.');
const directory = await mkdtemp(join(tmpdir(), 'epiless-index-benchmark-'));
const db = new DatabaseSync(join(directory, 'index.sqlite'));
try {
  for (const name of (await readdir('apps/web/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(await readFile(`apps/web/migrations/${name}`, 'utf8'));
  const user = db.prepare(
    'INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)',
  );
  const intent = db.prepare(
    "INSERT INTO publication_intents(id,owner_id,idempotency_key,content_hash,visibility,report_json,size_bytes,origin,status,route_count,state,created_at,expires_at,verified_until) VALUES(?,?,?,'synthetic','PUBLIC',?,?,?,?,?,'VERIFIED',?,?,?)",
  );
  const publish = db.prepare(
    "INSERT INTO publications(id,intent_id,owner_id,author_name,content_hash,visibility,report_json,origin,status,route_count,size_bytes,token_hash,published_at,public_origin_allowed) VALUES(?,?,?,'Synthetic benchmark','synthetic','PUBLIC',?,?,?,?,?,'synthetic',?,1)",
  );
  const base = structuredClone(exampleReport);
  base.routes = Array.from({ length: 8 }, (_, index) => ({
    ...structuredClone(base.routes[0]),
    url: `${base.origin}/route-${index}`,
  }));
  base.job.discoveredRoutes = base.job.visitedRoutes = 8;
  auditReportSchema.parse(base);
  const now = Date.now();
  let payloadBytes = 0;
  const start = performance.now();
  db.exec('BEGIN');
  for (let index = 0; index < count; index++) {
    const owner = `owner-${Math.floor(index / 10)}`;
    if (index % 10 === 0)
      user.run(owner, 'Synthetic', `${owner}@example.invalid`, now, now);
    const report = structuredClone(base);
    report.id = `benchmark-${index}`;
    report.origin = `https://site-${String(index % 1000).padStart(4, '0')}.example.com`;
    report.routes = report.routes.map((route, number) => ({
      ...route,
      url: `${report.origin}/route-${number}`,
    }));
    const json = stableJson(report);
    const bytes = Buffer.byteLength(json);
    payloadBytes += bytes;
    intent.run(
      report.id,
      owner,
      report.id,
      json,
      bytes,
      report.origin,
      report.status,
      8,
      now,
      now + 60000,
      now + 60000,
    );
    publish.run(
      report.id,
      report.id,
      owner,
      json,
      report.origin,
      report.status,
      8,
      bytes,
      now + index,
    );
  }
  db.exec('COMMIT; ANALYZE;');
  const ingestionMs = performance.now() - start;
  const queries = {
    recent: {
      sql: "SELECT id,origin,status,route_count,published_at FROM publications WHERE visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 ORDER BY published_at DESC,id DESC LIMIT 25",
      values: [],
    },
    origin: {
      sql: "SELECT id,origin,status,route_count,published_at FROM publications WHERE visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 AND origin=? ORDER BY published_at DESC LIMIT 25",
      values: ['https://site-0001.example.com'],
    },
    auditDate: {
      sql: "SELECT id,origin,status,route_count,audited_at FROM publications WHERE visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 AND audited_at>=? ORDER BY published_at DESC,id DESC LIMIT 21",
      values: [Date.parse(base.startedAt)],
    },
    domainPrefix: {
      sql: "SELECT id,origin,status,route_count,published_at FROM publications WHERE visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1 AND ((origin>=? AND origin<?) OR (origin>=? AND origin<?)) ORDER BY published_at DESC,id DESC LIMIT 21",
      values: [
        'https://site-0001.example.com',
        'https://site-0001.example.com\uffff',
        'http://site-0001.example.com',
        'http://site-0001.example.com\uffff',
      ],
    },
    siteSummary: {
      sql: "SELECT count(*) AS reports,MIN(audited_at) AS first_audit,MAX(audited_at) AS last_audit,SUM(CASE WHEN candidate_count>0 THEN 1 ELSE 0 END) AS reports_with_candidates,SUM(candidate_count) AS candidates FROM publications WHERE origin=? AND visibility='PUBLIC' AND state='ACTIVE' AND public_origin_allowed=1",
      values: ['https://site-0001.example.com'],
    },
  };
  /** @type {Record<string,{medianMs:number;p95Ms:number;plan:import("node:sqlite").SQLOutputValue[]}>} */
  const measured = {};
  for (const [name, query] of Object.entries(queries)) {
    const statement = db.prepare(query.sql);
    const samples = [];
    for (let run = 0; run < 200; run++) {
      const start = performance.now();
      const rows = statement.all(...query.values);
      if (rows.length > 25) throw new Error('Unbounded query.');
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    measured[name] = {
      medianMs: samples[100],
      p95Ms: samples[190],
      plan: db
        .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
        .all(...query.values)
        .map((row) => row.detail),
    };
  }
  const storageBytes =
    Number(db.prepare('PRAGMA page_count').get()?.page_count) *
    Number(db.prepare('PRAGMA page_size').get()?.page_size);
  const result = {
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    platform: process.platform,
    reports: count,
    routesPerReport: 8,
    payloadBytes,
    meanPayloadBytes: payloadBytes / count,
    sqliteStorageBytes: storageBytes,
    storageOverheadRatio: storageBytes / payloadBytes,
    ingestionMs,
    queries: measured,
    boundary:
      'Synthetic local SQLite storage and elapsed query latency only. Not Cloudflare Worker CPU, billable D1 rows, network throughput, or a monthly cost forecast.',
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/index-benchmark.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
  await rm(directory, { recursive: true, force: true });
}
