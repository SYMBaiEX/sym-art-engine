import type { LoadedProject } from '../config/loadProject.js';
import type { AssetRef, Trait } from '../schemas/trait.js';

/**
 * Resolve which asset set a trait renders with in the context of the
 * full combination. Variant `when` keys are either a category id
 * ("clothing") or "<namespace>Family" ("clothingFamily"); values match
 * the selected trait's id, name, family value, or full family token.
 */
export function resolveAssets(
  trait: Trait,
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): AssetRef[] {
  for (const variant of trait.variants) {
    if (variantMatches(variant.when, selected, project)) return variant.assets;
  }
  return trait.assets;
}

function variantMatches(
  when: Record<string, string>,
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): boolean {
  for (const [key, value] of Object.entries(when)) {
    let categoryId: string | undefined;
    let familyOnly = false;
    if (key.endsWith('Family')) {
      const ns = key.slice(0, -'Family'.length);
      categoryId = project.categoryByNamespace.get(ns)?.id;
      familyOnly = true;
    } else {
      categoryId =
        project.categoryById.get(key)?.id ?? project.categoryByName.get(key)?.id;
    }
    if (!categoryId) return false;
    const chosen = selected.get(categoryId);
    if (!chosen) return false;

    const familyValue = chosen.family?.split(':')[1];
    const matches = familyOnly
      ? familyValue === value || chosen.family === value
      : chosen.id === value ||
        chosen.name === value ||
        chosen.family === value ||
        familyValue === value;
    if (!matches) return false;
  }
  return true;
}
