import { join } from 'node:path';
import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import { resolveAssets } from './variants.js';

export interface PlacedAsset {
  slot: string;
  order: number;
  file: string;
  absoluteFile: string;
  traitId: string;
  traitName: string;
  category: string;
  opacity: number;
  blend: string;
}

/**
 * Flatten the selected traits into an ordered list of compositor
 * operations. Slot ordering comes entirely from project data (numeric
 * slot prefixes) — nothing here is collection-specific.
 */
export function buildRenderPlan(
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
  options: { include?: ReadonlySet<string> } = {},
): PlacedAsset[] {
  const placed: PlacedAsset[] = [];
  for (const category of project.categoryOrder) {
    if (options.include && !options.include.has(category.id)) continue;
    const trait = selected.get(category.id);
    if (!trait) continue;
    for (const asset of resolveAssets(trait, selected, project)) {
      const order = project.slotOrders.get(asset.slot);
      if (order === undefined) {
        throw new Error(
          `Trait "${trait.id}" asset "${asset.file}" uses unknown render slot "${asset.slot}"`,
        );
      }
      placed.push({
        slot: asset.slot,
        order,
        file: asset.file,
        absoluteFile: join(project.assetsDir, asset.file),
        traitId: trait.id,
        traitName: trait.name,
        category: trait.category,
        opacity: asset.opacity ?? 1,
        blend: asset.blend ?? 'normal',
      });
    }
  }
  // Stable sort: slot order first, then insertion (category) order.
  return placed
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.order - b.p.order || a.i - b.i)
    .map(({ p }) => p);
}
