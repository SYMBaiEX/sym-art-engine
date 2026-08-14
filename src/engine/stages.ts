import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import { ensureDir } from '../utils/fs.js';
import { checkerboard } from '../utils/images.js';
import { compositePlan } from './compositor.js';
import { buildRenderPlan } from './renderPlan.js';

/**
 * Cumulative stage previews: one image per public category, each adding
 * that category's trait on top of everything before it (01 = background
 * only, final = complete PFP).
 */
export async function renderStages(
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
  outDir: string,
): Promise<string[]> {
  ensureDir(outDir);
  const { width, height } = project.config.canvas;
  const written: string[] = [];
  const included = new Set<string>();
  let index = 0;
  for (const category of project.categoryOrder) {
    index += 1;
    included.add(category.id);
    const plan = buildRenderPlan(selected, project, { include: included });
    const buffer = await compositePlan(plan, { width, height });
    const file = join(
      outDir,
      `${String(index).padStart(2, '0')}-${category.id}.png`,
    );
    writeFileSync(file, buffer);
    written.push(file);
  }
  return written;
}

/**
 * Isolated previews: only the artwork contributed by a single trait,
 * over a checkerboard so transparency is visible.
 */
export async function renderIsolated(
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
  outDir: string,
): Promise<string[]> {
  ensureDir(outDir);
  const { width, height } = project.config.canvas;
  const board = await checkerboard(width, height);
  const written: string[] = [];
  for (const category of project.categoryOrder) {
    const trait = selected.get(category.id);
    if (!trait) continue;
    const plan = buildRenderPlan(selected, project, {
      include: new Set([category.id]),
    });
    if (plan.length === 0) continue;
    const buffer = await compositePlan(plan, { width, height, base: board });
    const file = join(outDir, `${trait.id.replaceAll('_', '-')}.png`);
    writeFileSync(file, buffer);
    written.push(file);
  }
  return written;
}
