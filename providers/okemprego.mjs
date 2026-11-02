// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// OkEmprego provider — Portugal/Brazil/Angola public jobs API (no auth):
// https://www.okemprego.com/api/v1/jobs
// Response shape: { data: [{ id, slug, url, title, company, country, city,
//   region, remote, category, contractType, experienceLevel, postedAt, ... }],
//   pagination: { page, perPage, total, totalPages } }
//
// Defaults to country=PT (Portugal). Override with `country` on the portal
// entry. Optional `query` / `category` / `experience_level` narrow the feed;
// without them the provider walks pages of the full PT inventory (capped).
//
// Wire in via a `job_boards:` entry with `provider: okemprego`.

const FEED_BASE = 'https://www.okemprego.com/api/v1/jobs';
const TRUSTED_HOSTS = new Set(['www.okemprego.com', 'okemprego.com']);
const DEFAULT_COUNTRY = 'PT';
const DEFAULT_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 20;

/** @param {string} url */
function assertOkempregoUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`okemprego: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`okemprego: URL must use HTTPS: ${url}`);
  if (!TRUSTED_HOSTS.has(parsed.hostname)) {
    throw new Error(`okemprego: untrusted hostname "${parsed.hostname}" — must be www.okemprego.com`);
  }
  return url;
}

/** @param {unknown} entry */
function resolveMaxPages(entry) {
  const v = entry && typeof entry === 'object' ? /** @type {any} */ (entry).max_pages : undefined;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** NaN-safe Date.parse → epoch ms. */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Build the location string from OkEmprego fields.
 * Exported for unit tests.
 * @param {any} j
 */
export function locationFromOkemprego(j) {
  if (!j || typeof j !== 'object') return '';
  const city = typeof j.city === 'string' ? j.city.trim() : '';
  const country = typeof j.country === 'string' ? j.country.trim() : '';
  const region = typeof j.region === 'string' ? j.region.trim() : '';
  const base = [city || region, country].filter(Boolean).join(', ');
  const remote = typeof j.remote === 'string' ? j.remote.trim().toLowerCase() : '';
  const remoteLabel =
    remote === 'remote' ? 'Remote' :
    remote === 'hybrid' ? 'Hybrid' :
    '';
  return [base, remoteLabel].filter(Boolean).join(', ');
}

/**
 * Normalize a single OkEmprego job. Exported for unit tests.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeOkempregoJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && TRUSTED_HOSTS.has(parsed.hostname)) url = parsed.href;
    } catch {
      // malformed → drop
    }
  }
  if (!url) return null;

  const company =
    (typeof j.company === 'string' && j.company.trim()) ||
    (typeof fallbackCompany === 'string' && fallbackCompany.trim()) ||
    'OkEmprego';

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = {
    title,
    url,
    company,
    location: locationFromOkemprego(j),
  };
  const postedAt = toEpochMs(j.postedAt) ?? toEpochMs(j.posted_at);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/**
 * Build the first-page feed URL from a portal entry. Exported for tests.
 * @param {any} [entry]
 */
export function buildOkempregoFeedUrl(entry = {}) {
  const params = new URLSearchParams();
  const country =
    (typeof entry.country === 'string' && entry.country.trim()) || DEFAULT_COUNTRY;
  params.set('country', country.toUpperCase());
  params.set('perPage', String(DEFAULT_PER_PAGE));
  params.set('page', '1');
  if (typeof entry.query === 'string' && entry.query.trim()) {
    params.set('q', entry.query.trim());
  }
  if (typeof entry.category === 'string' && entry.category.trim()) {
    params.set('category', entry.category.trim());
  }
  if (typeof entry.experience_level === 'string' && entry.experience_level.trim()) {
    params.set('experienceLevel', entry.experience_level.trim());
  }
  if (typeof entry.where === 'string' && entry.where.trim()) {
    params.set('where', entry.where.trim());
  }
  const url = `${FEED_BASE}?${params.toString()}`;
  return assertOkempregoUrl(url);
}

/** @type {Provider} */
export default {
  id: 'okemprego',

  detect(entry) {
    return entry?.provider === 'okemprego' ? { url: FEED_BASE } : null;
  },

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const firstUrl = buildOkempregoFeedUrl(entry);
    /** @type {Array<{ title: string, url: string, company: string, location: string, postedAt?: number }>} */
    const jobs = [];
    const seen = new Set();
    let pageUrl = firstUrl;
    const fallbackCompany = entry?.name;

    for (let page = 1; page <= maxPages; page++) {
      assertOkempregoUrl(pageUrl);
      const json = await ctx.fetchJson(pageUrl, { redirect: 'error' });
      if (!json || !Array.isArray(json.data)) {
        throw new Error(
          `okemprego: unexpected API response — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }

      for (const row of json.data) {
        const job = normalizeOkempregoJob(row, fallbackCompany);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      const totalPages =
        json.pagination && Number.isInteger(json.pagination.totalPages)
          ? json.pagination.totalPages
          : null;
      if (json.data.length === 0) break;
      if (totalPages !== null && page >= totalPages) break;
      if (page >= maxPages) {
        if (totalPages !== null && page < totalPages) {
          console.error(
            `⚠️  okemprego: ${entry?.name || 'OkEmprego'} truncated at max_pages=${maxPages} (${jobs.length} jobs)`,
          );
        }
        break;
      }

      const next = new URL(pageUrl);
      next.searchParams.set('page', String(page + 1));
      pageUrl = assertOkempregoUrl(next.href);
    }

    return jobs;
  },
};
