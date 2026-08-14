import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { cwd } from 'node:process';
import { loadProject, type LoadedProject } from '../config/loadProject.js';
import { compositePlan } from '../engine/compositor.js';
import { canonicalDnaSource, dnaHash } from '../engine/dna.js';
import { ENGINE_VERSION, generateCollection } from '../engine/generator.js';
import { buildMetadata } from '../engine/metadata.js';
import { buildRenderPlan } from '../engine/renderPlan.js';
import { resolveFixedEdition, selectEdition } from '../engine/selector.js';
import { renderIsolated, renderStages } from '../engine/stages.js';
import { formatIssue, validateProject } from '../engine/validator.js';
import { extractLayer, keyBackground, normalizeToCanvas } from '../tools/assetTools.js';
import { ensureDir, fileExists, writeJson } from '../utils/fs.js';
import { sha256 } from '../utils/hash.js';
import { createRng } from '../utils/prng.js';
import { startStudio } from '../preview/server.js';
import type { Trait } from '../schemas/trait.js';
import { readFileSync } from 'node:fs';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const purple = (s: string) => `\x1b[35m${s}\x1b[0m`;

/**
 * Resolve a project argument: an explicit path, or a name looked up in
 * ./projects/<name> and ../../projects/<name> relative to cwd (so the
 * CLI works from the monorepo root and from the engine package).
 */
function resolveProjectDir(nameOrPath: string): string {
  const candidates = [
    isAbsolute(nameOrPath) ? nameOrPath : resolve(cwd(), nameOrPath),
    resolve(cwd(), 'projects', nameOrPath),
    resolve(cwd(), '..', '..', 'projects', nameOrPath),
  ];
  for (const candidate of candidates) {
    if (fileExists(join(candidate, 'project.json'))) return candidate;
  }
  throw new Error(
    `Cannot find project "${nameOrPath}" (looked for project.json in: ${candidates.join(', ')})`,
  );
}

function defaultOutDir(project: LoadedProject, override?: string): string {
  if (override) return resolve(cwd(), override);
  const candidates = [
    resolve(cwd(), 'output'),
    resolve(cwd(), '..', '..', 'output'),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return join(candidate, project.config.slug);
  }
  return join(resolve(cwd(), 'output'), project.config.slug);
}

/** Resolve the traits of an edition: fixed if defined, else seeded random. */
function resolveEditionTraits(
  project: LoadedProject,
  edition: number,
  seed: string,
): Map<string, Trait> {
  const fixed = project.config.fixedEditions.find((f) => f.edition === edition);
  if (fixed) return resolveFixedEdition(project, fixed.traits);
  const rng = createRng(`${seed}:${edition}`);
  const result = selectEdition(project, rng, new Map());
  if (!result.ok) throw new Error(`Selection failed: ${result.reason}`);
  return result.traits;
}

const program = new Command();
program
  .name('sym')
  .description('SYM Art Engine — deterministic generative PFP engine')
  .version(ENGINE_VERSION);

program
  .command('validate')
  .argument('<project>', 'project name or path')
  .description('validate project config, trait manifests, rules, and assets')
  .action(async (projectArg: string) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const report = await validateProject(project);
    for (const issue of report.warnings) console.log(yellow(formatIssue(issue)));
    for (const issue of report.errors) console.log(red(formatIssue(issue)));
    console.log(
      `\n${project.config.name}: ${report.errors.length === 0 ? green('VALID') : red('INVALID')} ` +
        dim(`(${report.errors.length} errors, ${report.warnings.length} warnings, ${project.traits.length} traits)`),
    );
    if (report.errors.length > 0) process.exitCode = 1;
  });

program
  .command('render')
  .argument('<project>')
  .option('-e, --edition <n>', 'edition number', '1')
  .option('-s, --seed <seed>', 'seed for non-fixed editions', 'SYM_PREVIEW')
  .option('-o, --out <dir>', 'output directory')
  .description('render a single edition PNG + metadata')
  .action(async (projectArg: string, opts: { edition: string; seed: string; out?: string }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const edition = parseInt(opts.edition, 10);
    const selected = resolveEditionTraits(project, edition, opts.seed);
    const plan = buildRenderPlan(selected, project);
    const { width, height } = project.config.canvas;
    const buffer = await compositePlan(plan, { width, height });

    const outDir = defaultOutDir(project, opts.out);
    const padded = String(edition).padStart(project.config.metadata.editionPadding, '0');
    ensureDir(join(outDir, 'images'));
    ensureDir(join(outDir, 'metadata'));
    const imagePath = join(outDir, 'images', `${padded}.png`);
    writeFileSync(imagePath, buffer);
    writeJson(join(outDir, 'metadata', `${padded}.json`), buildMetadata(edition, selected, project));

    console.log(green(`Rendered edition ${edition}`));
    console.log(dim(`  image     ${imagePath}`));
    console.log(dim(`  dna       ${dnaHash(selected, project)}`));
  });

program
  .command('stages')
  .argument('<project>')
  .option('-e, --edition <n>', 'edition number', '1')
  .option('-s, --seed <seed>', 'seed for non-fixed editions', 'SYM_PREVIEW')
  .option('-o, --out <dir>', 'output directory')
  .description('render cumulative stage previews + isolated trait previews')
  .action(async (projectArg: string, opts: { edition: string; seed: string; out?: string }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const edition = parseInt(opts.edition, 10);
    const selected = resolveEditionTraits(project, edition, opts.seed);
    const outDir = defaultOutDir(project, opts.out);
    const stages = await renderStages(selected, project, join(outDir, 'stages'));
    const isolated = await renderIsolated(selected, project, join(outDir, 'previews', 'isolated'));
    console.log(green(`Rendered ${stages.length} cumulative stages`));
    for (const file of stages) console.log(dim(`  ${file}`));
    console.log(green(`Rendered ${isolated.length} isolated previews`));
    for (const file of isolated) console.log(dim(`  ${file}`));
  });

program
  .command('generate')
  .argument('<project>')
  .option('-c, --count <n>', 'edition count', '10')
  .option('-s, --seed <seed>', 'deterministic build seed', 'SYM_DEFAULT')
  .option('-o, --out <dir>', 'output directory')
  .option('--dry-run', 'evaluate rules + DNA + distributions without rendering')
  .option('--debug', 'write per-edition internal debug JSON')
  .description('generate a collection deterministically from a seed')
  .action(async (projectArg: string, opts: { count: string; seed: string; out?: string; dryRun?: boolean; debug?: boolean }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const validation = await validateProject(project);
    if (validation.errors.length > 0) {
      for (const issue of validation.errors) console.log(red(formatIssue(issue)));
      throw new Error('Validation failed — fix the errors above before generating.');
    }
    const outDir = defaultOutDir(project, opts.out);
    const count = parseInt(opts.count, 10);
    const result = await generateCollection(project, {
      count,
      seed: opts.seed,
      outDir,
      dryRun: opts.dryRun,
      debug: opts.debug,
      onProgress: (edition, total) => {
        if (edition % 50 === 0 || edition === total) {
          process.stdout.write(`\r${dim(`generated ${edition}/${total}`)}`);
        }
      },
    });
    process.stdout.write('\n');
    console.log(green(`${opts.dryRun ? 'Dry-run evaluated' : 'Generated'} ${result.report.stats.generated}/${count} editions`) + dim(` seed=${opts.seed}`));
    console.log(dim(`  rerolls   ${result.report.stats.totalRerolls}`));
    console.log(dim(`  rejected  ${JSON.stringify(result.report.stats.rejected)}`));
    console.log(dim(`  reports   ${join(outDir, 'reports')}`));
    if (result.manifestPath) console.log(dim(`  manifest  ${result.manifestPath}`));
  });

program
  .command('analyze')
  .argument('<project>')
  .option('-c, --count <n>', 'edition count to simulate', '1000')
  .option('-s, --seed <seed>', 'seed', 'SYM_ANALYZE')
  .option('-o, --out <dir>', 'output directory')
  .description('dry-run a large build and produce distribution reports')
  .action(async (projectArg: string, opts: { count: string; seed: string; out?: string }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const outDir = defaultOutDir(project, opts.out);
    const result = await generateCollection(project, {
      count: parseInt(opts.count, 10),
      seed: opts.seed,
      outDir,
      dryRun: true,
    });
    console.log(green(`Analyzed ${result.report.stats.generated} simulated editions`));
    console.log(dim(`  report ${join(outDir, 'reports', 'dry-run-report.html')}`));
  });

program
  .command('dna')
  .argument('<project>')
  .option('-e, --edition <n>', 'edition number', '1')
  .option('-s, --seed <seed>', 'seed for non-fixed editions', 'SYM_PREVIEW')
  .description('print the canonical DNA source + hash for an edition')
  .action((projectArg: string, opts: { edition: string; seed: string }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const selected = resolveEditionTraits(project, parseInt(opts.edition, 10), opts.seed);
    console.log(canonicalDnaSource(selected, project));
    console.log(purple(dnaHash(selected, project)));
  });

program
  .command('studio')
  .argument('<project>')
  .option('-p, --port <port>', 'port', '4477')
  .option('-o, --out <dir>', 'output directory for saved previews')
  .description('open the local combination-explorer web UI')
  .action(async (projectArg: string, opts: { port: string; out?: string }) => {
    const projectDir = resolveProjectDir(projectArg);
    const project = loadProject(projectDir);
    const outDir = defaultOutDir(project, opts.out);
    const port = parseInt(opts.port, 10);
    await startStudio(projectDir, port, outDir);
    console.log(purple(`SYM Studio → http://localhost:${port}`));
  });

program
  .command('preview')
  .argument('<project>')
  .option('-s, --seed <seed>', 'seed', String(Date.now()))
  .option('-o, --out <dir>', 'output directory')
  .description('render one random legal edition to previews/')
  .action(async (projectArg: string, opts: { seed: string; out?: string }) => {
    const project = loadProject(resolveProjectDir(projectArg));
    const rng = createRng(opts.seed);
    const result = selectEdition(project, rng, new Map());
    if (!result.ok) throw new Error(`Selection failed: ${result.reason}`);
    const plan = buildRenderPlan(result.traits, project);
    const { width, height } = project.config.canvas;
    const buffer = await compositePlan(plan, { width, height });
    const outDir = join(defaultOutDir(project, opts.out), 'previews');
    ensureDir(outDir);
    const file = join(outDir, `random-${opts.seed}.png`);
    writeFileSync(file, buffer);
    console.log(green(`Preview saved`) + dim(` ${file} seed=${opts.seed}`));
    for (const [categoryId, trait] of result.traits) {
      console.log(dim(`  ${categoryId.padEnd(12)} ${trait.name}`));
    }
  });

const tools = program.command('tools').description('asset pipeline utilities');

tools
  .command('key')
  .requiredOption('-i, --in <file>')
  .requiredOption('-o, --out <file>')
  .requiredOption('-c, --color <hex>', 'background color to key out')
  .option('-t, --tolerance <n>', 'full-transparency distance', '26')
  .option('--softness <n>', 'full-opacity distance', '60')
  .description('chroma-key a solid background color to transparency')
  .action(async (opts: { in: string; out: string; color: string; tolerance: string; softness: string }) => {
    const buffer = await keyBackground(opts.in, {
      color: opts.color,
      tolerance: parseFloat(opts.tolerance),
      softness: parseFloat(opts.softness),
    });
    writeFileSync(opts.out, buffer);
    console.log(green(`Keyed ${opts.in} → ${opts.out}`));
  });

tools
  .command('extract')
  .requiredOption('--prev <file>', 'previous cumulative stage')
  .requiredOption('--next <file>', 'next cumulative stage')
  .requiredOption('-o, --out <file>', 'output layer PNG')
  .option('-t, --threshold <n>', 'per-channel change threshold', '18')
  .option('--despeckle <n>', 'speckle removal radius', '2')
  .option('--close <n>', 'mask closing radius', '3')
  .option('--fill-holes', 'fill fully enclosed mask holes')
  .description('extract the layer one cumulative stage added over another')
  .action(async (opts: { prev: string; next: string; out: string; threshold: string; despeckle: string; close: string; fillHoles?: boolean }) => {
    const buffer = await extractLayer(opts.prev, opts.next, {
      threshold: parseFloat(opts.threshold),
      despeckle: parseInt(opts.despeckle, 10),
      close: parseInt(opts.close, 10),
      fillHoles: opts.fillHoles,
    });
    writeFileSync(opts.out, buffer);
    console.log(green(`Extracted layer ${opts.next} - ${opts.prev} → ${opts.out}`));
  });

tools
  .command('normalize')
  .requiredOption('-i, --in <file>')
  .requiredOption('-o, --out <file>')
  .requiredOption('-w, --width <n>')
  .requiredOption('--height <n>')
  .description('resize/pad an image to an exact canvas (contain, transparent pad)')
  .action(async (opts: { in: string; out: string; width: string; height: string }) => {
    const buffer = await normalizeToCanvas(opts.in, parseInt(opts.width, 10), parseInt(opts.height, 10));
    writeFileSync(opts.out, buffer);
    console.log(green(`Normalized ${opts.in} → ${opts.out}`));
  });

tools
  .command('hash')
  .requiredOption('-i, --in <file>')
  .description('print the sha256 of a file (golden-test bookkeeping)')
  .action((opts: { in: string }) => {
    console.log(sha256(readFileSync(opts.in)));
  });

program.parseAsync().catch((err: Error) => {
  console.error(red(err.message));
  process.exit(1);
});
