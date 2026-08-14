import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import { sha256 } from '../utils/hash.js';

/**
 * Canonical DNA is built from stable trait IDs (never filenames) in
 * category order. Per-category config controls whether None selections
 * participate. The same combination always hashes identically across
 * machines and engine runs.
 */
export function canonicalDnaSource(
  traits: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): string {
  const lines: string[] = [];
  for (const category of project.categoryOrder) {
    const trait = traits.get(category.id);
    if (!trait) continue;
    if (trait.none && !category.includeNoneInDna) continue;
    lines.push(`${category.id}=${trait.id}`);
  }
  return lines.join('\n');
}

export function dnaHash(
  traits: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): string {
  return sha256(canonicalDnaSource(traits, project));
}
