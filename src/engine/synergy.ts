import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import { traitMatchesSelector } from './selectors.js';

export interface SynergyResult {
  score: number;
  matches: { name: string; when: string[]; score: number }[];
}

/**
 * Positive synergy scoring: every rule whose `when` selectors are all
 * matched by the combination contributes its score. Used for analysis,
 * validation, and optional reroll thresholds — never as a hard filter
 * unless the project configures one.
 */
export function evaluateSynergy(
  traits: readonly Trait[],
  project: LoadedProject,
): SynergyResult {
  const matches: SynergyResult['matches'] = [];
  for (const rule of project.rules.synergies) {
    const hit = rule.when.every((sel) =>
      traits.some((t) => traitMatchesSelector(sel, t, project)),
    );
    if (hit) {
      matches.push({
        name: rule.name ?? rule.when.join(' + '),
        when: rule.when,
        score: rule.score,
      });
    }
  }
  return { score: matches.reduce((sum, m) => sum + m.score, 0), matches };
}
