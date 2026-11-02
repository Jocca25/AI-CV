import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { employerRequest, CHINA_PRESET } from "@/lib/employer-preset.mjs";
import { PORTUGAL_PRESET, portugalRequest, PORTUGAL_SOURCES } from "@/lib/portugal-preset.mjs";
import { runEmployerDiscovery } from "@/lib/core/employer-discovery.mjs";
import { runPortugalDiscovery } from "@/lib/core/portugal-discovery.mjs";
import { runDiscovery } from "@/lib/core/scan";
import { rootScript } from "@/lib/career-ops";
import { parseExplorePatch, DEFAULT_FILTERS, type DiscoveredOffer, type ScanEvent } from "@/lib/explore";
import { scannerMissingBody, SCANNER_MISSING_STATUS } from "@/lib/explore-error.mjs";
import { readJsonObject } from "@/lib/json-body";

// Discovery is HTTP-bound across many ATS boards; give it room. It is FREE —
// zero LLM tokens (the scanner only does HTTP + JSON, and --dry-run writes nothing).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await readJsonObject(req)) ?? {};

  const employer = body.preset === CHINA_PRESET;
  const portugal = body.preset === PORTUGAL_PRESET;
  // Validate the raw source selection before the forgiving legacy filter codec.
  if (body.preset && !employer && !portugal) {
    return Response.json({ error: "Unknown discovery preset." }, { status: 400 });
  }
  if (employer) {
    try { employerRequest(body); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Invalid sources" }, { status: 400 }); }
  }
  if (portugal) {
    try { portugalRequest(body); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Invalid sources" }, { status: 400 }); }
  }
  const filters = parseExplorePatch(body, DEFAULT_FILTERS);

  // Guard: a data-only checkout (or pre-onboarding) has no scanner. Fail soft.
  // The body carries an explicit code because 400 is a shared channel: the
  // client cannot tell this apart from a malformed request by status alone.
  const needed = portugal ? "scan-portugal" : employer ? "scan" : "scan-ats-full";
  if (!fs.existsSync(rootScript(needed))) {
    return Response.json(scannerMissingBody(), { status: SCANNER_MISSING_STATUS });
  }

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  if (req.signal.aborted) abort.abort();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      const startAts = portugal
        ? [...PORTUGAL_SOURCES]
        : employer
          ? filters.employers ?? []
          : filters.ats;
      send({
        kind: "start",
        ats: startAts,
        sinceDays: employer || portugal ? 0 : filters.sinceDays,
        limit: employer || portugal ? 0 : filters.limitPerAts,
        free: true,
      } satisfies ScanEvent);
      let offers: DiscoveredOffer[] = [];
      try {
        if (portugal) {
          offers = (await runPortugalDiscovery(body, {
            signal: abort.signal,
            onEvent: (e: ScanEvent) => send(e),
          })) as DiscoveredOffer[];
        } else if (employer) {
          offers = await runEmployerDiscovery(body, {
            codeRoot: path.dirname(rootScript("scan")),
            signal: abort.signal,
            onEvent: (e: ScanEvent) => send(e),
          });
        } else {
          offers = await runDiscovery(filters, (e: ScanEvent) => send(e));
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "discovery failed" } satisfies ScanEvent);
      }
      send({ kind: "done", count: offers.length, offers, cost: { tokens: 0, usd: 0 } } satisfies ScanEvent);
      controller.close();
    },
    cancel() { abort.abort(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
