// tests/scan-portugal.test.mjs
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan-portugal helpers');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'scan-portugal.mjs')).href);
  const { buildPortugalSearchLinks, portugalSearchQueries, formatPortugalReport } = mod;

  const links = buildPortugalSearchLinks();
  if (
    Array.isArray(links)
    && links.length >= 3
    && links.some(l => /linkedin\.com\/jobs\/search/i.test(l.url))
    && links.some(l => /net-empregos\.com/i.test(l.url))
    && links.some(l => /itjobs\.pt/i.test(l.url))
    && links.every(l => typeof l.note === 'string' && l.note.length > 0)
  ) {
    pass('buildPortugalSearchLinks returns LinkedIn + NetEmpregos + ITJobs deep-links with notes');
  } else {
    fail(`buildPortugalSearchLinks = ${JSON.stringify(links)}`);
  }

  // LinkedIn must carry internship/entry experience filter and a location.
  const li = links.find(l => /linkedin\.com/i.test(l.url));
  const liUrl = new URL(li.url);
  if (liUrl.searchParams.get('f_E') === '1,2' && /Lisbon|Lisboa|Portugal/i.test(liUrl.searchParams.get('location') || '')) {
    pass('LinkedIn deep-link sets f_E=1,2 (intern/entry) and a Portugal location');
  } else {
    fail(`LinkedIn deep-link params unexpected: ${li.url}`);
  }

  const queries = portugalSearchQueries({
    search_queries: [
      { name: 'PT — LinkedIn', query: 'site:linkedin.com/jobs Lisbon Intern', enabled: true },
      { name: 'US only', query: 'site:boards.greenhouse.io New York', enabled: true },
      { name: 'PT off', query: 'Portugal Junior', enabled: false },
    ],
  });
  if (queries.length === 1 && queries[0].name === 'PT — LinkedIn') {
    pass('portugalSearchQueries keeps only enabled PT-related portals.yml queries');
  } else {
    fail(`portugalSearchQueries = ${JSON.stringify(queries)}`);
  }

  const md = formatPortugalReport({
    date: '2026-11-02',
    admitted: [
      {
        company: 'Noesis',
        title: 'Consultor Junior',
        location: 'Lisboa, PT, Hybrid',
        source: 'okemprego',
        url: 'https://www.okemprego.com/pt/empregos/x',
      },
    ],
    skippedLabel: 'title=2',
    fetchedBySource: { landingjobs: 10, okemprego: 5 },
    errors: [],
    searchLinks: links.slice(0, 1),
    webQueries: queries,
    pipelineAdded: null,
  });
  if (
    md.includes('# Vagas Portugal — 2026-11-02')
    && md.includes('Noesis')
    && md.includes('Consultor Junior')
    && md.includes('Links de pesquisa')
    && md.includes('linkedin.com')
  ) {
    pass('formatPortugalReport renders a PT markdown report with jobs + search links');
  } else {
    fail(`formatPortugalReport missing expected sections: ${md.slice(0, 400)}`);
  }
} catch (err) {
  fail(`scan-portugal tests threw: ${err?.stack || err}`);
}
