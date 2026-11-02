#!/usr/bin/env node
/**
 * scan-portugal.mjs — multi-site Portugal job discovery (zero-token).
 *
 * Pulls public board APIs that already ship with career-ops (Landing.jobs,
 * OkEmprego, Arbeitnow, RemoteOK, Remotive, Himalayas), keeps only postings
 * that pass the user's portals.yml title + location filters (Portugal /
 * Lisboa / Porto…), and writes a readable report under output/.
 *
 * LinkedIn / NetEmpregos / ITJobs are NOT scraped (ToS / robots). The report
 * includes ready-to-open search deep-links so you can browse those sites by
 * hand. Nothing is submitted automatically.
 *
 * Usage:
 *   node scan-portugal.mjs
 *   node scan-portugal.mjs --pipeline          # also append new matches to data/pipeline.md
 *   node scan-portugal.mjs --dry-run           # fetch + filter, write nothing
 *   node scan-portugal.mjs --json              # machine receipt on stdout
 *   npm run scan:portugal
 */

try {
  const { config } = await import('dotenv');
  config();
} catch {
  // optional
}

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadYaml } from './lib/yaml-document.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { createAdmissionGate, formatSkipCounts } from './lib/admission-gate.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { validateFlags, hasFlag, flagValue } from './lib/cli-flags.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import {
  PORTALS_PATH,
  appendToPipeline,
  appendToScanHistory,
} from './scan.mjs';

import landingjobs from './providers/landingjobs.mjs';
import okemprego from './providers/okemprego.mjs';
import arbeitnow from './providers/arbeitnow.mjs';
import remoteok from './providers/remoteok.mjs';
import remotive from './providers/remotive.mjs';
import himalayas from './providers/himalayas.mjs';

const KNOWN_FLAGS = ['--help', '-h', '--pipeline', '--dry-run', '--json', '--limit'];
const USAGE = `Usage:
  node scan-portugal.mjs                 # fetch Portugal-relevant boards → output/
  node scan-portugal.mjs --pipeline      # also append NEW matches to data/pipeline.md
  node scan-portugal.mjs --dry-run       # fetch + filter, write nothing
  node scan-portugal.mjs --json          # one JSON receipt on stdout
  node scan-portugal.mjs --limit 30      # cap listed jobs in the report (default 80)

Sources (public APIs, no login):
  • Landing.jobs   — tech board, strong Lisbon/Porto coverage
  • OkEmprego      — Portugal jobs API (IT/data + estágio/junior queries)
  • Arbeitnow      — EU remote/on-site feed (kept only if location matches PT)
  • RemoteOK / Remotive / Himalayas — remote feeds (kept only if location matches PT)

LinkedIn, NetEmpregos and ITJobs are listed as SEARCH LINKS only — they are
never scraped. Open those links in your browser to review results by hand.

Filters come from portals.yml (title_filter + location_filter + blacklist).`;

const DATA_ROOT = getCareerOpsRoot();
const OUTPUT_DIR = path.join(DATA_ROOT, 'output');

/** Default OkEmprego queries aimed at João's intern/junior/IT search. */
const OK_EMPREGO_QUERIES = [
  { name: 'OkEmprego PT IT/data', country: 'PT', category: 'it-data', max_pages: 3 },
  {
    name: 'OkEmprego PT estágio/junior',
    country: 'PT',
    category: 'it-data',
    query: 'estágio OR junior OR intern OR trainee OR estágio',
    max_pages: 2,
  },
];

/**
 * Manual search deep-links (human browse only — never fetched by this script).
 * Exported for unit tests.
 * @param {{ keywords?: string, location?: string }} [opts]
 */
export function buildPortugalSearchLinks(opts = {}) {
  const keywords =
    opts.keywords ||
    'Estágio OR Junior OR Intern OR Trainee OR "Data Analyst" OR BI OR Developer';
  const location = opts.location || 'Lisbon, Portugal';
  const li = new URL('https://www.linkedin.com/jobs/search/');
  li.searchParams.set('keywords', keywords);
  li.searchParams.set('location', location);
  // 1 = Internship, 2 = Entry level (LinkedIn experience filter)
  li.searchParams.set('f_E', '1,2');
  li.searchParams.set('f_TPR', 'r604800'); // past week

  const net = new URL('https://www.net-empregos.com/pesquisa-empregos.asp');
  net.searchParams.set('chaves', 'estagio junior dados informatica');
  net.searchParams.set('local', 'lisboa');

  const itjobs = new URL('https://www.itjobs.pt/emprego');
  itjobs.searchParams.set('q', 'estágio junior');
  itjobs.searchParams.set('location', 'Lisboa');

  const landingSearch = new URL('https://landing.jobs/at');
  // Landing has no stable public search URL with query; point at the board home.
  const landingHome = 'https://landing.jobs/';

  return [
    {
      name: 'LinkedIn — estágio/junior Lisboa (última semana)',
      url: li.href,
      note: 'Abre no browser. Não é feito scrape automático.',
    },
    {
      name: 'NetEmpregos — estágio/junior Lisboa',
      url: net.href,
      note: 'Portal português clássico; abrir e filtrar à mão.',
    },
    {
      name: 'ITJobs.pt — estágio/junior Lisboa',
      url: itjobs.href,
      note: 'Board tech PT; robots bloqueiam filtros automatizados — só link manual.',
    },
    {
      name: 'Landing.jobs — board tech Europa/PT',
      url: landingHome,
      note: 'Também pesquisado automaticamente por este script.',
    },
    {
      name: 'Landing.jobs — empresas',
      url: landingSearch.href,
      note: 'Listagem de empresas no board.',
    },
  ];
}

/**
 * Load portals.yml (same path scan.mjs uses).
 * @returns {object}
 */
function loadPortals() {
  if (!existsSync(PORTALS_PATH)) return {};
  try {
    return loadYaml(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  } catch (err) {
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Enabled search_queries from portals.yml whose name/query mention PT/Portugal.
 * Exported for tests.
 * @param {object} portals
 */
export function portugalSearchQueries(portals) {
  const list = Array.isArray(portals?.search_queries) ? portals.search_queries : [];
  return list
    .filter(q => q && q.enabled !== false && typeof q.query === 'string')
    .filter(q => /portugal|lisboa|lisbon|porto|\bPT\b/i.test(`${q.name || ''} ${q.query}`))
    .map(q => ({
      name: q.name || 'WebSearch PT',
      query: q.query,
      note: 'Query para WebSearch / Google (site:…). O agente ou tu correm a pesquisa — este script não faz scrape.',
    }));
}

/**
 * Fetch one provider safely; return [] on failure and record the error.
 * @param {string} sourceId
 * @param {{ fetch: Function }} provider
 * @param {object} entry
 * @param {ReturnType<typeof makeHttpCtx>} ctx
 * @param {Array<{source: string, error: string}>} errors
 */
async function fetchSource(sourceId, provider, entry, ctx, errors) {
  try {
    const jobs = await provider.fetch(entry, ctx);
    if (!Array.isArray(jobs)) {
      errors.push({ source: sourceId, error: 'provider returned non-array' });
      return [];
    }
    return jobs.map(j => ({ ...j, source: sourceId }));
  } catch (err) {
    errors.push({ source: sourceId, error: err?.message || String(err) });
    console.error(`⚠️  ${sourceId}: ${err?.message || err}`);
    return [];
  }
}

/**
 * Format the human markdown report.
 * @param {object} opts
 */
export function formatPortugalReport({
  date,
  admitted,
  skippedLabel,
  fetchedBySource,
  errors,
  searchLinks,
  webQueries,
  pipelineAdded,
}) {
  const lines = [];
  lines.push(`# Vagas Portugal — ${date}`);
  lines.push('');
  lines.push(`Gerado por \`scan-portugal.mjs\`. Filtros: \`portals.yml\` (títulos + localização Portugal).`);
  lines.push('');
  lines.push('## Resumo');
  lines.push('');
  lines.push(`- Vagas novas / admitidas: **${admitted.length}**`);
  if (skippedLabel) lines.push(`- Ignoradas: ${skippedLabel}`);
  if (pipelineAdded != null) lines.push(`- Adicionadas ao pipeline: **${pipelineAdded}**`);
  lines.push('');
  lines.push('### Por fonte (bruto → antes dos filtros de título/localização)');
  lines.push('');
  for (const [source, n] of Object.entries(fetchedBySource)) {
    lines.push(`- ${source}: ${n}`);
  }
  if (errors.length) {
    lines.push('');
    lines.push('### Erros de fonte');
    lines.push('');
    for (const e of errors) lines.push(`- ${e.source}: ${e.error}`);
  }
  lines.push('');
  lines.push('## Links de pesquisa (abrir no browser)');
  lines.push('');
  lines.push('Estes sites **não** são lidos automaticamente (política / robots / ToS). Usa os links:');
  lines.push('');
  for (const link of searchLinks) {
    lines.push(`- [${link.name}](${link.url}) — ${link.note}`);
  }
  if (webQueries.length) {
    lines.push('');
    lines.push('### Queries WebSearch (de `portals.yml`)');
    lines.push('');
    for (const q of webQueries) {
      lines.push(`- **${q.name}**: \`${q.query}\``);
    }
  }
  lines.push('');
  lines.push('## Vagas encontradas');
  lines.push('');
  if (!admitted.length) {
    lines.push('_Nenhuma vaga nova passou os filtros desta corrida._');
  } else {
    lines.push('| # | Empresa | Título | Local | Fonte | Link |');
    lines.push('|---|---------|--------|-------|-------|------|');
    admitted.forEach((job, i) => {
      const company = (job.company || '—').replace(/\|/g, '/');
      const title = (job.title || '—').replace(/\|/g, '/');
      const loc = (job.location || '—').replace(/\|/g, '/');
      const src = job.source || '—';
      const url = job.url || '';
      lines.push(`| ${i + 1} | ${company} | ${title} | ${loc} | ${src} | [abrir](${url}) |`);
    });
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Próximo passo sugerido: escolher 3–10 links → `avalia esta` / colar o URL para avaliação completa.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Programmatic Portugal multi-site scan (also used by the web Explore UI).
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=80]
 * @param {boolean} [opts.writeFiles=false] - write output/portugal-jobs-*.{md,json}
 * @param {boolean} [opts.toPipeline=false] - append admitted jobs to data/pipeline.md
 * @param {boolean} [opts.quiet=false]
 * @param {(ev: {kind: string, source?: string, count?: number, message?: string}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function runPortugalScan(opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 80;
  const writeFiles = opts.writeFiles === true;
  const toPipeline = opts.toPipeline === true;
  const quiet = opts.quiet === true;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const signal = opts.signal;

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error('Portugal scan aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  const portals = loadPortals();
  const gate = createAdmissionGate({ config: portals });
  const ctx = makeHttpCtx();
  const today = localToday();
  /** @type {Array<{source: string, error: string}>} */
  const errors = [];
  /** @type {Record<string, number>} */
  const fetchedBySource = {};

  const log = (...a) => {
    if (!quiet) console.log(...a);
  };

  log('🇵🇹  Scan Portugal — a procurar vagas em vários sites…\n');
  throwIfAborted();

  /** @type {any[]} */
  let raw = [];

  // Landing.jobs
  {
    onProgress({ kind: 'sourceStart', source: 'landingjobs' });
    const jobs = await fetchSource('landingjobs', landingjobs, { name: 'Landing.jobs' }, ctx, errors);
    throwIfAborted();
    fetchedBySource.landingjobs = jobs.length;
    raw.push(...jobs);
    onProgress({ kind: 'sourceDone', source: 'landingjobs', count: jobs.length });
    log(`  Landing.jobs: ${jobs.length} vagas`);
  }

  // OkEmprego — Portugal-native API (two complementary queries, deduped later)
  for (const entry of OK_EMPREGO_QUERIES) {
    onProgress({ kind: 'sourceStart', source: 'okemprego' });
    const jobs = await fetchSource(`okemprego:${entry.name}`, okemprego, entry, ctx, errors);
    throwIfAborted();
    const key = entry.name;
    fetchedBySource[key] = jobs.length;
    raw.push(...jobs.map(j => ({ ...j, source: 'okemprego' })));
    onProgress({ kind: 'sourceDone', source: 'okemprego', count: jobs.length });
    log(`  ${entry.name}: ${jobs.length} vagas`);
  }

  // Remote / EU boards — location_filter will drop non-PT
  for (const [id, provider, entry] of [
    ['arbeitnow', arbeitnow, { name: 'Arbeitnow', max_pages: 2 }],
    ['remoteok', remoteok, { name: 'RemoteOK' }],
    ['remotive', remotive, { name: 'Remotive' }],
    ['himalayas', himalayas, { name: 'Himalayas', max_pages: 2 }],
  ]) {
    onProgress({ kind: 'sourceStart', source: /** @type {string} */ (id) });
    const jobs = await fetchSource(/** @type {string} */ (id), /** @type {any} */ (provider), entry, ctx, errors);
    throwIfAborted();
    fetchedBySource[/** @type {string} */ (id)] = jobs.length;
    raw.push(...jobs);
    onProgress({ kind: 'sourceDone', source: /** @type {string} */ (id), count: jobs.length });
    log(`  ${id}: ${jobs.length} vagas`);
  }

  // Dedup by URL before the admission gate
  const byUrl = new Map();
  for (const job of raw) {
    if (!job?.url) continue;
    if (!byUrl.has(job.url)) byUrl.set(job.url, job);
  }
  const unique = [...byUrl.values()];

  /** @type {any[]} */
  const admitted = [];
  for (const job of unique) {
    if (gate.check(job)) continue;
    admitted.push(job);
  }

  const listed = admitted.slice(0, limit);
  const searchLinks = buildPortugalSearchLinks();
  const webQueries = portugalSearchQueries(portals);
  const skippedLabel = formatSkipCounts(gate.counts);

  const outBase = `portugal-jobs-${today}`;
  const mdPath = path.join(OUTPUT_DIR, `${outBase}.md`);
  const jsonPath = path.join(OUTPUT_DIR, `${outBase}.json`);

  /** @type {any} */
  const reportJson = {
    date: today,
    admitted: listed.length,
    totalFetched: raw.length,
    uniqueFetched: unique.length,
    fetchedBySource,
    skipped: gate.counts,
    errors,
    searchLinks,
    webQueries,
    jobs: listed.map(j => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      source: j.source,
      postedAt: j.postedAt ?? null,
    })),
    files: writeFiles ? { markdown: mdPath, json: jsonPath } : null,
    pipeline: false,
  };

  if (writeFiles) {
    const reportMd = formatPortugalReport({
      date: today,
      admitted: listed,
      skippedLabel,
      fetchedBySource,
      errors,
      searchLinks,
      webQueries,
      pipelineAdded: toPipeline ? listed.length : null,
    });
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(mdPath, reportMd, 'utf-8');
    writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), 'utf-8');
    log(`\n📄 Relatório: ${mdPath}`);
    log(`📦 JSON:      ${jsonPath}`);

    if (toPipeline && listed.length > 0) {
      await appendToPipeline(listed);
      await appendToScanHistory(listed, today, 'added');
      reportJson.pipeline = true;
      log(`📥 Pipeline:  ${listed.length} vagas novas em data/pipeline.md`);
    }
  }

  return reportJson;
}

async function main(args = process.argv.slice(2)) {
  const dryRun = hasFlag(args, '--dry-run');
  const toPipeline = hasFlag(args, '--pipeline');
  const jsonMode = hasFlag(args, '--json');
  const limitRaw = flagValue(args, '--limit');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 80) : 80;

  const reportJson = await runPortugalScan({
    limit,
    writeFiles: !dryRun,
    toPipeline: !dryRun && toPipeline,
    quiet: jsonMode,
  });

  if (dryRun && !jsonMode) logDryRun();

  const {
    date: today,
    admitted,
    totalFetched,
    uniqueFetched,
    fetchedBySource,
    errors,
    searchLinks,
    jobs: listed,
  } = reportJson;
  const skippedLabel = formatSkipCounts(reportJson.skipped || {});

  if (jsonMode) {
    console.log(JSON.stringify(reportJson, null, 2));
  } else {
    printScanSummaryHeader('Portugal Scan', today);
    console.log(`Fontes OK:          ${Object.keys(fetchedBySource).length - errors.length}/${Object.keys(fetchedBySource).length}`);
    console.log(`Vagas brutas:       ${totalFetched} (${uniqueFetched} únicas)`);
    console.log(`Admitidas:          ${admitted}${admitted > listed.length ? ` (a mostrar ${listed.length})` : ''}`);
    if (skippedLabel) console.log(`Ignoradas:          ${skippedLabel}`);
    if (errors.length) console.log(`Erros de fonte:     ${errors.length}`);
    console.log(`Links manuais:      ${searchLinks.length} (LinkedIn, NetEmpregos, ITJobs…)`);
    if (listed.length) {
      console.log('\nTop matches:');
      for (const job of listed.slice(0, 10)) {
        console.log(`  • ${job.company} — ${job.title} (${job.location || '?'}) [${job.source}]`);
        console.log(`    ${job.url}`);
      }
      if (listed.length > 10) console.log(`  … e mais ${listed.length - 10} no relatório.`);
    }
    console.log('\nDica: npm run scan:portugal -- --pipeline   # envia as novas para data/pipeline.md');
    console.log('      Ou no site: Explore → Portugal boards → Pesquisar Portugal');
  }

  // Partial source failure is a soft warning; total wipe of every source is hard.
  if (errors.length && errors.length === Object.keys(fetchedBySource).length && admitted === 0) {
    process.exitCode = 1;
  }
}

function logDryRun() {
  console.log('\n(--dry-run: nada escrito)');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  main(args).catch(err => {
    console.error('Fatal:', err?.message || err);
    process.exit(1);
  });
}
