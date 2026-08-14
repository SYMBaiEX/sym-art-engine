import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../config/loadProject.js';
import { checkCandidate, evaluateSet } from '../engine/compatibility.js';
import { compositePlan } from '../engine/compositor.js';
import { canonicalDnaSource, dnaHash } from '../engine/dna.js';
import { buildMetadata } from '../engine/metadata.js';
import { evaluatePalette } from '../engine/palette.js';
import { buildRenderPlan, type PlacedAsset } from '../engine/renderPlan.js';
import { selectEdition } from '../engine/selector.js';
import { evaluateSynergy } from '../engine/synergy.js';
import { ensureDir } from '../utils/fs.js';
import { checkerboard } from '../utils/images.js';
import { applyOpacity } from '../utils/images.js';
import { createRng } from '../utils/prng.js';
import sharp from 'sharp';
import type { Trait } from '../schemas/trait.js';

const PREVIEW_SIZE = 700;

/**
 * SYM Studio: local combination explorer. Deliberately a small vanilla
 * HTTP server + single HTML page — a debugging tool, not a SaaS.
 */
export async function startStudio(
  projectDir: string,
  port: number,
  outDir: string,
): Promise<void> {
  let project = loadProject(projectDir);
  const assetCache = new Map<string, Buffer>();
  let board: Buffer | null = null;

  const previewBuffer = async (asset: PlacedAsset): Promise<Buffer> => {
    const key = `${asset.absoluteFile}:${asset.opacity}`;
    const cached = assetCache.get(key);
    if (cached) return cached;
    let buffer = await sharp(asset.absoluteFile).resize(PREVIEW_SIZE).png().toBuffer();
    if (asset.opacity < 1) buffer = await applyOpacity(buffer, asset.opacity);
    assetCache.set(key, buffer);
    return buffer;
  };

  const parseSelection = (params: URLSearchParams): Map<string, Trait> => {
    const selected = new Map<string, Trait>();
    const raw = params.get('traits') ?? '';
    for (const pair of raw.split(',').filter(Boolean)) {
      const [categoryId, traitId] = pair.split(':');
      if (!categoryId || !traitId) continue;
      const trait = project.traitById.get(traitId);
      if (trait && trait.category === categoryId) selected.set(categoryId, trait);
    }
    return selected;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const params = url.searchParams;

      if (url.pathname === '/') {
        const html = readFileSync(
          fileURLToPath(new URL('./public/index.html', import.meta.url)),
          'utf8',
        );
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }

      if (url.pathname === '/api/project') {
        // Reload from disk on every project fetch so trait edits appear on refresh.
        project = loadProject(projectDir);
        assetCache.clear();
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            name: project.config.name,
            slug: project.config.slug,
            canvas: project.config.canvas,
            slots: project.config.slots,
            categories: project.categoryOrder.map((c) => ({
              id: c.id,
              name: c.name,
              optional: c.optional,
            })),
            traits: project.traits.map((t) => ({
              id: t.id,
              category: t.category,
              name: t.name,
              none: t.none,
              family: t.family,
              tags: t.tags,
              weight: t.rarity?.weight ?? t.weight ?? 100,
              tier: t.rarity?.tier,
              assets: t.assets,
            })),
          }),
        );
        return;
      }

      if (url.pathname === '/api/render') {
        const selected = parseSelection(params);
        const hidden = new Set((params.get('hide') ?? '').split(',').filter(Boolean));
        const isolate = params.get('isolate');
        const plan = buildRenderPlan(selected, project, {
          include: isolate ? new Set([isolate]) : undefined,
        }).filter((p) => !hidden.has(p.slot));

        // Assets are pre-resized to PREVIEW_SIZE, so composite on a
        // preview-sized canvas for a fast hot path.
        let base: Buffer | undefined;
        if (isolate) {
          board ??= await checkerboard(PREVIEW_SIZE, PREVIEW_SIZE);
          base = board;
        }
        const png = await compositePlan(plan, {
          width: PREVIEW_SIZE,
          height: PREVIEW_SIZE,
          base,
          bufferFor: previewBuffer,
        });
        res.writeHead(200, { 'content-type': 'image/png' }).end(png);
        return;
      }

      if (url.pathname === '/api/evaluate') {
        const selected = parseSelection(params);
        const traits = [...selected.values()];
        const violations = evaluateSet(traits, project);
        const synergy = evaluateSynergy(traits, project);
        const palette = evaluatePalette(traits, project);
        const plan = buildRenderPlan(selected, project);

        // Per-category candidate status for "why is this blocked" UX
        const options: Record<string, { id: string; name: string; blocked: string | null }[]> = {};
        for (const category of project.categoryOrder) {
          const others = traits.filter((t) => t.category !== category.id);
          options[category.id] = (project.byCategory.get(category.id) ?? []).map(
            (candidate) => {
              const issues = checkCandidate(candidate, others, project);
              return {
                id: candidate.id,
                name: candidate.name,
                blocked: issues.length > 0 ? (issues[0]?.message ?? 'blocked') : null,
              };
            },
          );
        }

        const overall = Math.round(
          (violations.length === 0 ? 100 : 0) * 0.5 +
            palette.score * 0.35 +
            Math.min(100, Math.max(0, 50 + synergy.score * 10)) * 0.15,
        );

        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            valid: violations.length === 0,
            violations,
            synergy,
            palette,
            overall,
            dna: dnaHash(selected, project),
            dnaSource: canonicalDnaSource(selected, project),
            metadata: buildMetadata(0, selected, project),
            renderPlan: plan.map((p) => ({
              slot: p.slot,
              order: p.order,
              file: p.file,
              trait: p.traitName,
              opacity: p.opacity,
              blend: p.blend,
            })),
            options,
          }),
        );
        return;
      }

      if (url.pathname === '/api/random') {
        const seed = params.get('seed') || String(Date.now());
        const rng = createRng(seed);
        const result = selectEdition(project, rng, new Map());
        if (!result.ok) {
          res.writeHead(409, { 'content-type': 'application/json' }).end(
            JSON.stringify({ error: result.reason }),
          );
          return;
        }
        const traits: Record<string, string> = {};
        for (const [categoryId, trait] of result.traits) traits[categoryId] = trait.id;
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({ seed, traits }),
        );
        return;
      }

      if (url.pathname === '/api/save' && req.method === 'POST') {
        const selected = parseSelection(params);
        const plan = buildRenderPlan(selected, project);
        const { width, height } = project.config.canvas;
        const buffer = await compositePlan(plan, { width, height });
        const dir = ensureDir(join(outDir, 'previews'));
        const file = join(dir, `studio-${Date.now()}.png`);
        writeFileSync(file, buffer);
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({ file }),
        );
        return;
      }

      res.writeHead(404).end('not found');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(
        JSON.stringify({ error: (err as Error).message }),
      );
    }
  });

  await new Promise<void>((resolvePromise) => server.listen(port, resolvePromise));
}
