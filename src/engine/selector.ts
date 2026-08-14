import type { LoadedProject } from '../config/loadProject.js';
import { traitWeight, type Trait } from '../schemas/trait.js';
import { pickWeighted, type Rng } from '../utils/prng.js';
import {
  checkCandidate,
  pendingRequirementsFor,
} from './compatibility.js';
import { traitMatchesSelector } from './selectors.js';

export interface SelectionSuccess {
  ok: true;
  /** categoryId -> selected trait */
  traits: Map<string, Trait>;
}

export interface SelectionFailure {
  ok: false;
  reason: string;
}

export type SelectionResult = SelectionSuccess | SelectionFailure;

/**
 * Select one trait per category in selection order (categories flagged
 * selectAfterCharacter — typically Background — pick last so contrast
 * rules can see the finished character). Candidates are filtered by
 * occurrence caps, compatibility state, and pending requirements before
 * a weighted pick.
 */
export function selectEdition(
  project: LoadedProject,
  rng: Rng,
  occurrence: ReadonlyMap<string, number>,
): SelectionResult {
  const selected = new Map<string, Trait>();

  for (const category of project.selectionOrder) {
    const pool = project.byCategory.get(category.id) ?? [];
    const selectedList = [...selected.values()];
    const pending = pendingRequirementsFor(category.id, selectedList, project);

    const candidates = pool.filter((trait) => {
      const cap = trait.rarity?.exact ?? trait.rarity?.max;
      if (cap != null && (occurrence.get(trait.id) ?? 0) >= cap) return false;
      if (!pending.every((sel) => traitMatchesSelector(sel, trait, project))) {
        return false;
      }
      return checkCandidate(trait, selectedList, project).length === 0;
    });

    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `dead-end:${category.id}`,
      };
    }

    selected.set(category.id, pickWeighted(rng, candidates, traitWeight));
  }

  return { ok: true, traits: selected };
}

/** Resolve a fixed (hand-authored) edition, validating every reference. */
export function resolveFixedEdition(
  project: LoadedProject,
  editionTraits: Record<string, string>,
): Map<string, Trait> {
  const selected = new Map<string, Trait>();
  for (const [categoryId, traitId] of Object.entries(editionTraits)) {
    if (!project.categoryById.has(categoryId)) {
      throw new Error(`Fixed edition references unknown category "${categoryId}"`);
    }
    const trait = project.traitById.get(traitId);
    if (!trait) {
      throw new Error(`Fixed edition references unknown trait "${traitId}"`);
    }
    if (trait.category !== categoryId) {
      throw new Error(
        `Fixed edition assigns trait "${traitId}" to category "${categoryId}" but it belongs to "${trait.category}"`,
      );
    }
    selected.set(categoryId, trait);
  }
  for (const category of project.categoryOrder) {
    if (!selected.has(category.id) && !category.optional) {
      throw new Error(`Fixed edition is missing category "${category.id}"`);
    }
  }
  return selected;
}
