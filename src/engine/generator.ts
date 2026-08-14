import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import { ensureDir, listFiles, writeJson } from '../utils/fs.js';
import { hashObject, sha256 } from '../utils/hash.js';
import { createRng } from '../utils/prng.js';
import { evaluateSet } from './compatibility.js';
import { compositePlan } from './compositor.js';
import { canonicalDnaSource, dnaHash } from './dna.js';
import { buildMetadata } from './metadata.js';
import { evaluatePalette } from './palette.js';
import { buildRenderPlan } from './renderPlan.js';
import {
  buildCollectionReport,
  reportToHtml,
  traitRecord,
  type BuildStats,
  type CollectionReport,
  type EditionRecord,
} from './reports.js';
import { resolveFixedEdition, selectEdition } from './selector.js';
import { evaluateSynergy } from './synergy.js';

export interface GenerateOptions {
  count: number;
  seed: string;
  outDir: string;
  dryRun?: boolean;
  /** Write per-edition internal debug JSON (never public metadata). */
  debug?: boolean;
  onProgress?: (edition: number, count: number) => void;
}

export interface GenerateResult {
  report: CollectionReport;
  editions: EditionRecord[];
  manifestPath?: string;
}

export const ENGINE_VERSION = '0.1.0';

export class GenerationError extends Error {}

/**
 * Full generation pipeline:
 * seeded selection -> hard rules -> synergy -> palette -> reroll ->
 * canonical DNA -> duplicate check -> variant resolution -> render plan ->
 * composite -> image QA -> metadata -> reports -> build manifest.
 * Dry-run stops before rendering.
 */
export async function generateCollection(
  project: LoadedProject,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const started = Date.now();
  const rng = createRng(options.seed);
  const gen = project.config.generation;

  const editions: EditionRecord[] = [];
  const rejected: Record<string, number> = {};
  const seenDna = new Set<string>();
  const seenImageHash = new Map<string, number>();
  const occurrence = new Map<string, number>();
  let totalRerolls = 0;

  const outDir = options.outDir;
  const imagesDir = join(outDir, 'images');
  const metadataDir = join(outDir, 'metadata');
  const reportsDir = join(outDir, 'reports');
  const debugDir = join(reportsDir, 'debug');
  ensureDir(reportsDir);
  if (!options.dryRun) {
    ensureDir(imagesDir);
    ensureDir(metadataDir);
  }
  if (options.debug) ensureDir(debugDir);

  const fixedByEdition = new Map(
    project.config.fixedEditions.map((f) => [f.edition, f]),
  );

  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
    totalRerolls += 1;
  };

  for (let edition = 1; edition <= options.count; edition++) {
    let selected: Map<string, Trait> | null = null;
    let rerolls = 0;
    let synergyScore = 0;
    let paletteScore = 0;

    const fixed = fixedByEdition.get(edition);
    if (fixed) {
      selected = resolveFixedEdition(project, fixed.traits);
      const violations = evaluateSet([...selected.values()], project);
      if (violations.length > 0) {
        throw new GenerationError(
          `Fixed edition ${edition} violates rules:\n${violations.map((v) => v.message).join('\n')}`,
        );
      }
      synergyScore = evaluateSynergy([...selected.values()], project).score;
      paletteScore = evaluatePalette([...selected.values()], project).score;
    } else {
      for (let attempt = 0; attempt < gen.maxRerolls; attempt++) {
        const result = selectEdition(project, rng, occurrence);
        if (!result.ok) {
          reject(result.reason);
          rerolls += 1;
          continue;
        }
        const traits = [...result.traits.values()];

        const violations = evaluateSet(traits, project);
        if (violations.length > 0) {
          reject(`rule-violation:${violations[0]?.rule ?? 'unknown'}`);
          rerolls += 1;
          continue;
        }

        const palette = evaluatePalette(traits, project);
        if (palette.blocked.length > 0) {
          reject('palette-blocked');
          rerolls += 1;
          continue;
        }
        if (
          gen.paletteRerollBelow != null &&
          palette.score < gen.paletteRerollBelow
        ) {
          reject('palette-low-score');
          rerolls += 1;
          continue;
        }

        const synergy = evaluateSynergy(traits, project);
        if (
          gen.synergyRerollBelow != null &&
          synergy.score < gen.synergyRerollBelow
        ) {
          reject('synergy-low-score');
          rerolls += 1;
          continue;
        }

        const dna = dnaHash(result.traits, project);
        if (!gen.allowDuplicates && seenDna.has(dna)) {
          reject('duplicate-dna');
          rerolls += 1;
          continue;
        }

        selected = result.traits;
        synergyScore = synergy.score;
        paletteScore = palette.score;
        break;
      }
    }

    if (!selected) {
      throw new GenerationError(
        `Could not generate edition ${edition} after ${gen.maxRerolls} attempts. ` +
          `Rejections so far: ${JSON.stringify(rejected)}. ` +
          `The trait pool may be too constrained for ${options.count} unique editions.`,
      );
    }

    const dna = dnaHash(selected, project);
    seenDna.add(dna);
    for (const trait of selected.values()) {
      occurrence.set(trait.id, (occurrence.get(trait.id) ?? 0) + 1);
    }

    const record: EditionRecord = {
      edition,
      dna,
      traits: traitRecord(selected, project),
      synergyScore,
      paletteScore,
      rerolls,
    };
    editions.push(record);

    if (!options.dryRun) {
      const plan = buildRenderPlan(selected, project);
      const { width, height } = project.config.canvas;
      const buffer = await compositePlan(plan, { width, height });

      // Image QA: exact dimensions are guaranteed by the compositor; check
      // for duplicate output images as a secondary DNA sanity check.
      const imageHash = sha256(buffer);
      const priorEdition = seenImageHash.get(imageHash);
      if (priorEdition !== undefined && !gen.allowDuplicates) {
        rejected['duplicate-image-hash'] =
          (rejected['duplicate-image-hash'] ?? 0) + 1;
      }
      seenImageHash.set(imageHash, edition);

      const padded = String(edition).padStart(
        project.config.metadata.editionPadding,
        '0',
      );
      writeFileSync(join(imagesDir, `${padded}.png`), buffer);
      writeJson(
        join(metadataDir, `${padded}.json`),
        buildMetadata(edition, selected, project),
      );

      if (options.debug) {
        writeJson(join(debugDir, `${padded}.json`), {
          edition,
          seed: options.seed,
          dna,
          dnaSource: canonicalDnaSource(selected, project),
          traits: [...selected.values()].map((t) => ({
            id: t.id,
            category: t.category,
            name: t.name,
          })),
          resolvedAssets: plan.map((p) => p.file),
          renderPlan: plan.map((p) => ({
            slot: p.slot,
            order: p.order,
            file: p.file,
            trait: p.traitId,
            opacity: p.opacity,
            blend: p.blend,
          })),
          compatibilityScore: 100,
          synergyScore,
          paletteScore,
          imageHash,
          rerolls,
        });
      }
    }

    options.onProgress?.(edition, options.count);
  }

  const stats: BuildStats = {
    requested: options.count,
    generated: editions.length,
    rejected,
    totalRerolls,
    durationMs: Date.now() - started,
  };

  const report = buildCollectionReport(
    project,
    editions,
    stats,
    options.seed,
    options.dryRun ?? false,
  );
  writeJson(join(reportsDir, options.dryRun ? 'dry-run-report.json' : 'collection-report.json'), report);
  writeFileSync(
    join(reportsDir, options.dryRun ? 'dry-run-report.html' : 'collection-report.html'),
    reportToHtml(report),
  );

  let manifestPath: string | undefined;
  if (!options.dryRun) {
    manifestPath = join(outDir, 'build-manifest.json');
    writeJson(manifestPath, buildManifest(project, options, editions, stats));
  }

  return { report, editions, manifestPath };
}

function buildManifest(
  project: LoadedProject,
  options: GenerateOptions,
  editions: readonly EditionRecord[],
  stats: BuildStats,
) {
  const assetFiles = listFiles(project.assetsDir, '.png');
  const assetHashes: Record<string, string> = {};
  for (const file of assetFiles) {
    assetHashes[file.slice(project.assetsDir.length + 1)] = sha256(
      readFileSync(file),
    );
  }
  return {
    engineVersion: ENGINE_VERSION,
    projectVersion: project.config.projectVersion,
    traitSchemaVersion: project.config.traitSchemaVersion,
    buildDate: new Date().toISOString(),
    seed: options.seed,
    requestedEditions: options.count,
    generatedEditions: stats.generated,
    projectConfigHash: hashObject(project.config),
    traitManifestHash: hashObject(project.traits),
    assetSetHash: sha256(Object.values(assetHashes).sort().join('')),
    assetHashes,
    renderDimensions: project.config.canvas,
    generationDurationMs: stats.durationMs,
    outputDnaHashes: editions.map((e) => e.dna),
  };
}
