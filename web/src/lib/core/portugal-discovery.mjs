/**
 * ACL: Explore → Portugal boards.
 *
 * Spawns `node scan-portugal.mjs --json --dry-run` (same contract as the CLI /
 * `npm run scan:portugal`). Maps jobs to DiscoveredOffer and streams ScanEvents
 * the Explore UI already understands. Never writes the pipeline — the user
 * reviews cards and clicks Add.
 *
 * Spawn (not a dynamic import): Next/Turbopack refuses pathToFileURL imports of
 * checkout-root scripts ("Cannot find module as expression is too dynamic").
 */

import { spawn } from "node:child_process";
import { rootScript } from "@/lib/career-ops";
import { PORTUGAL_SOURCES, PORTUGAL_SOURCE_LABEL } from "../portugal-preset.mjs";

function postedAtYmd(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return "";
}

function toOffer(job) {
  const source = typeof job.source === "string" && job.source ? job.source : "portugal";
  return {
    url: job.url,
    company: job.company || "—",
    title: job.title || "—",
    location: job.location || "",
    postedAt: postedAtYmd(job.postedAt),
    ats: source,
    source,
  };
}

/**
 * Run scan-portugal.mjs --json --dry-run and parse the single JSON object on stdout.
 * @param {{ signal?: AbortSignal }} [opts]
 */
function spawnPortugalScan({ signal } = {}) {
  return new Promise((resolve, reject) => {
    const script = rootScript("scan-portugal");
    const child = spawn(process.execPath, [script, "--json", "--dry-run", "--limit", "80"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        const err = new Error("Portugal scan aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      const text = stdout.trim();
      // Prefer a full-stdout parse. If dotenv (or similar) ever prefixes stdout,
      // fall back to the first `{`…end slice — never lastIndexOf("{"), which
      // lands inside nested objects (searchLinks / skipped) and breaks parse.
      try {
        resolve(JSON.parse(text));
        return;
      } catch {
        /* try first-brace slice below */
      }
      const start = text.indexOf("{");
      if (start < 0) {
        reject(new Error(stderr.trim() || `scan-portugal exited ${code} with no JSON`));
        return;
      }
      try {
        resolve(JSON.parse(text.slice(start)));
      } catch (err) {
        reject(new Error(`scan-portugal JSON parse failed: ${err.message}`));
      }
    });
  });
}

/**
 * @param {object} _raw - Explore POST body (preset already validated)
 * @param {{ signal?: AbortSignal, onEvent?: (e: import('../explore').ScanEvent) => void }} [opts]
 * @returns {Promise<import('../explore').DiscoveredOffer[]>}
 */
export async function runPortugalDiscovery(_raw, opts = {}) {
  const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
  const signal = opts.signal;

  for (const id of PORTUGAL_SOURCES) {
    onEvent({ kind: "atsStart", ats: id, companies: 1 });
  }

  const report = await spawnPortugalScan({ signal });

  for (const id of PORTUGAL_SOURCES) {
    const count = Number(report?.fetchedBySource?.[id] ?? report?.fetchedBySource?.[`OkEmprego PT IT/data`] ?? 0);
    onEvent({ kind: "progress", ats: id, scanned: 1, total: 1, matches: count });
    onEvent({ kind: "atsDone", ats: id, unreachable: 0 });
  }

  const jobs = Array.isArray(report?.jobs) ? report.jobs : [];
  /** @type {import('../explore').DiscoveredOffer[]} */
  const offers = [];
  const seen = new Set();
  for (const job of jobs) {
    if (!job?.url || seen.has(job.url)) continue;
    seen.add(job.url);
    const offer = toOffer(job);
    offers.push(offer);
    onEvent({ kind: "offer", offer });
  }

  const searchLinks = Array.isArray(report?.searchLinks) ? report.searchLinks : [];
  if (searchLinks.length) {
    onEvent({ kind: "searchLinks", links: searchLinks });
  }

  const sourceKeys = Object.keys(report?.fetchedBySource || {});
  const errorSources = new Set(
    (report?.errors || [])
      .map((e) => (typeof e.source === "string" ? e.source.split(":")[0] : ""))
      .filter(Boolean),
  );
  const incomplete = PORTUGAL_SOURCES.filter((id) => errorSources.has(id));

  onEvent({
    kind: "summary",
    companiesScanned: sourceKeys.length || PORTUGAL_SOURCES.length,
    companiesAvailable: PORTUGAL_SOURCES.length,
    unreachable: incomplete.length,
    matches: offers.length,
    incomplete: incomplete.length
      ? incomplete.map((id) => PORTUGAL_SOURCE_LABEL[id] || id)
      : undefined,
  });

  return offers;
}
