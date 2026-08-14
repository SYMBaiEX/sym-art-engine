import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';

/**
 * Selector grammar (used by allows/blocks/requires, exclusive groups,
 * conditional rules, and synergies):
 *
 *   trait:<id>              exact trait id
 *   tag:<tag>               any trait carrying the tag
 *   category:<categoryId>   any trait of the category
 *   <namespace>:<value>     family selector, e.g. "growth:rear"
 *                           ("<namespace>:none" also matches None traits)
 *   <Category Name>:<Name>  public-name selector, e.g. "Headwear:Black Cap"
 */
export function traitMatchesSelector(
  selector: string,
  trait: Trait,
  project: LoadedProject,
): boolean {
  if (selector.startsWith('trait:')) return trait.id === selector.slice(6);
  if (selector.startsWith('tag:')) return trait.tags.includes(selector.slice(4));
  if (selector.startsWith('category:')) {
    const rest = selector.slice(9);
    const category = project.categoryById.get(trait.category);
    return trait.category === rest || category?.name === rest;
  }

  const colon = selector.indexOf(':');
  if (colon === -1) return false;
  const left = selector.slice(0, colon);
  const right = selector.slice(colon + 1);

  // Public "Category Name:Trait Name"
  const byName = project.categoryByName.get(left);
  if (byName) return trait.category === byName.id && trait.name === right;

  // Family "<namespace>:<value>"
  const byNamespace = project.categoryByNamespace.get(left);
  if (byNamespace) {
    if (trait.category !== byNamespace.id) return false;
    if (right === 'none' && trait.none) return true;
    return trait.family === `${left}:${right}`;
  }
  return false;
}

export function anySelectorMatches(
  selectors: readonly string[],
  trait: Trait,
  project: LoadedProject,
): boolean {
  return selectors.some((s) => traitMatchesSelector(s, trait, project));
}

/**
 * The category a selector is scoped to, or null when it cannot be
 * statically resolved (tag selectors span categories).
 */
export function selectorCategory(
  selector: string,
  project: LoadedProject,
): string | null {
  if (selector.startsWith('trait:')) {
    return project.traitById.get(selector.slice(6))?.category ?? null;
  }
  if (selector.startsWith('tag:')) return null;
  if (selector.startsWith('category:')) {
    const rest = selector.slice(9);
    if (project.categoryById.has(rest)) return rest;
    return project.categoryByName.get(rest)?.id ?? null;
  }
  const colon = selector.indexOf(':');
  if (colon === -1) return null;
  const left = selector.slice(0, colon);
  return (
    project.categoryByName.get(left)?.id ??
    project.categoryByNamespace.get(left)?.id ??
    null
  );
}

/** True when a selector matches at least one trait defined in the project. */
export function selectorResolvable(
  selector: string,
  project: LoadedProject,
): boolean {
  return project.traits.some((t) => traitMatchesSelector(selector, t, project));
}
