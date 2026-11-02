// tests/providers/okemprego.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — okemprego');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/okemprego.mjs')).href);
  const okemprego = mod.default;
  const { normalizeOkempregoJob, locationFromOkemprego, buildOkempregoFeedUrl } = mod;

  if (okemprego.id === 'okemprego') pass('okemprego.id is "okemprego"');
  else fail(`okemprego.id is ${JSON.stringify(okemprego.id)}`);

  if (
    locationFromOkemprego({ city: 'Lisboa', country: 'PT', remote: 'hybrid' }) === 'Lisboa, PT, Hybrid'
    && locationFromOkemprego({ city: '', region: 'Porto', country: 'PT', remote: 'remote' }) === 'Porto, PT, Remote'
    && locationFromOkemprego(null) === ''
  ) {
    pass('locationFromOkemprego builds city/country + remote/hybrid labels');
  } else {
    fail(`locationFromOkemprego unexpected: ${JSON.stringify([
      locationFromOkemprego({ city: 'Lisboa', country: 'PT', remote: 'hybrid' }),
      locationFromOkemprego({ city: '', region: 'Porto', country: 'PT', remote: 'remote' }),
    ])}`);
  }

  const full = normalizeOkempregoJob({
    title: '  Estágio Data  ',
    url: 'https://www.okemprego.com/pt/empregos/estagio-data',
    company: 'Acme Lda',
    city: 'Lisboa',
    country: 'PT',
    remote: 'hybrid',
    postedAt: '2026-10-31T01:06:14.115Z',
  });
  if (
    full
    && full.title === 'Estágio Data'
    && full.company === 'Acme Lda'
    && full.location === 'Lisboa, PT, Hybrid'
    && full.url === 'https://www.okemprego.com/pt/empregos/estagio-data'
    && full.postedAt === Date.parse('2026-10-31T01:06:14.115Z')
  ) {
    pass('normalizeOkempregoJob maps title/url/company/location/postedAt');
  } else {
    fail(`normalizeOkempregoJob full = ${JSON.stringify(full)}`);
  }

  const drops = [
    normalizeOkempregoJob({ title: 'x', url: 'https://evil.example/job' }),
    normalizeOkempregoJob({ title: 'x', url: 'http://www.okemprego.com/pt/empregos/x' }),
    normalizeOkempregoJob({ title: '', url: 'https://www.okemprego.com/pt/empregos/x' }),
    normalizeOkempregoJob(null),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeOkempregoJob host-locks URL and drops bad rows');
  } else {
    fail(`normalizeOkempregoJob drops = ${JSON.stringify(drops)}`);
  }

  const feed = buildOkempregoFeedUrl({ country: 'PT', category: 'it-data', query: 'junior' });
  if (
    feed.startsWith('https://www.okemprego.com/api/v1/jobs?')
    && feed.includes('country=PT')
    && feed.includes('category=it-data')
    && feed.includes('q=junior')
  ) {
    pass('buildOkempregoFeedUrl builds a locked HTTPS feed URL with filters');
  } else {
    fail(`buildOkempregoFeedUrl = ${feed}`);
  }

  const sample = {
    data: [
      {
        title: 'Junior Analyst',
        url: 'https://www.okemprego.com/pt/empregos/junior-analyst',
        company: 'Noesis',
        city: 'Lisboa',
        country: 'PT',
        remote: 'hybrid',
        postedAt: '2026-10-31T01:06:14.115Z',
      },
      { title: '', url: 'https://www.okemprego.com/pt/empregos/bad' },
    ],
    pagination: { page: 1, perPage: 50, total: 1, totalPages: 1 },
  };
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await okemprego.fetch(
    { name: 'OkEmprego', country: 'PT', category: 'it-data', max_pages: 1 },
    {
      fetchJson: async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return sample;
      },
    },
  );

  if (capturedUrl && capturedUrl.includes('country=PT') && capturedUrl.includes('category=it-data')) {
    pass('okemprego.fetch() requests the PT it-data feed');
  } else {
    fail(`okemprego.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('okemprego.fetch() passes redirect:"error" (SSRF guard)');
  } else {
    fail(`okemprego.fetch() redirect opts = ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 1 && fetched[0]?.company === 'Noesis' && fetched[0]?.title === 'Junior Analyst') {
    pass('okemprego.fetch() returns normalized jobs and drops empty titles');
  } else {
    fail(`okemprego.fetch() result = ${JSON.stringify(fetched)}`);
  }
} catch (err) {
  fail(`okemprego tests threw: ${err?.stack || err}`);
}
