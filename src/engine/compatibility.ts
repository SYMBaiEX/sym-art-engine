import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';
import type { ConditionalRule } from '../schemas/rules.js';
import {
  anySelectorMatches,
  selectorCategory,
  traitMatchesSelector,
} from './selectors.js';

export interface Violation {
  rule:
    | 'blocks'
    | 'allows'
    | 'requires'
    | 'exclusive-group'
    | 'conditional-blocks'
    | 'conditional-allows'
    | 'conditional-requires';
  source: string;
  target: string;
  message: string;
}

/** Conditional rules whose `when` selectors are all satisfied. */
export function activeConditionalRules(
  selected: readonly Trait[],
  project: LoadedProject,
): ConditionalRule[] {
  return project.rules.conditional.filter((rule) =>
    rule.when.every((sel) =>
      selected.some((t) => traitMatchesSelector(sel, t, project)),
    ),
  );
}

/**
 * allows-lists are scoped: group a trait's `allows` selectors by the
 * category they resolve to. If a candidate falls inside a scoped
 * category, it must match at least one selector of that group.
 */
function allowsViolation(
  ownerLabel: string,
  allows: readonly string[],
  candidate: Trait,
  project: LoadedProject,
  rule: Violation['rule'],
): Violation | null {
  if (allows.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const sel of allows) {
    const cat = selectorCategory(sel, project);
    if (!cat) continue; // tag: selectors carry no category scope
    const list = groups.get(cat) ?? [];
    list.push(sel);
    groups.set(cat, list);
  }
  const group = groups.get(candidate.category);
  if (!group) return null;
  if (anySelectorMatches(group, candidate, project)) return null;
  return {
    rule,
    source: ownerLabel,
    target: candidate.id,
    message: `${ownerLabel} only allows [${group.join(', ')}] for category "${candidate.category}", which "${candidate.name}" does not match`,
  };
}

/**
 * Check a candidate trait against the already-selected traits plus all
 * project rules. Empty result = compatible.
 */
export function checkCandidate(
  candidate: Trait,
  selected: readonly Trait[],
  project: LoadedProject,
): Violation[] {
  const violations: Violation[] = [];

  for (const other of selected) {
    // Two-way blocks
    for (const sel of other.blocks) {
      if (traitMatchesSelector(sel, candidate, project)) {
        violations.push({
          rule: 'blocks',
          source: other.id,
          target: candidate.id,
          message: `"${other.name}" blocks "${sel}" which matches "${candidate.name}"`,
        });
      }
    }
    for (const sel of candidate.blocks) {
      if (traitMatchesSelector(sel, other, project)) {
        violations.push({
          rule: 'blocks',
          source: candidate.id,
          target: other.id,
          message: `"${candidate.name}" blocks "${sel}" which matches "${other.name}"`,
        });
      }
    }
    // Two-way scoped allows
    const a = allowsViolation(other.id, other.allows, candidate, project, 'allows');
    if (a) violations.push(a);
    const b = allowsViolation(candidate.id, candidate.allows, other, project, 'allows');
    if (b) violations.push(b);
  }

  // Mutually exclusive groups
  for (const group of project.rules.exclusiveGroups) {
    if (!anySelectorMatches(group.members, candidate, project)) continue;
    const clash = selected.find((t) =>
      anySelectorMatches(group.members, t, project),
    );
    if (clash) {
      violations.push({
        rule: 'exclusive-group',
        source: clash.id,
        target: candidate.id,
        message: `Exclusive group "${group.name}" already satisfied by "${clash.name}"`,
      });
    }
  }

  // Conditional rules active for the current selection
  for (const rule of activeConditionalRules(selected, project)) {
    for (const sel of rule.blocks) {
      if (traitMatchesSelector(sel, candidate, project)) {
        violations.push({
          rule: 'conditional-blocks',
          source: rule.name ?? rule.when.join(' + '),
          target: candidate.id,
          message: `Conditional rule "${rule.name ?? rule.when.join(' + ')}" blocks "${sel}"`,
        });
      }
    }
    const cv = allowsViolation(
      rule.name ?? 'conditional rule',
      rule.allows,
      candidate,
      project,
      'conditional-allows',
    );
    if (cv) violations.push(cv);
  }

  // Requires already-selected categories immediately
  for (const sel of candidate.requires) {
    const cat = selectorCategory(sel, project);
    if (!cat) continue;
    const chosen = selected.find((t) => t.category === cat);
    if (chosen && !traitMatchesSelector(sel, chosen, project)) {
      violations.push({
        rule: 'requires',
        source: candidate.id,
        target: chosen.id,
        message: `"${candidate.name}" requires "${sel}" but "${chosen.name}" is selected`,
      });
    }
  }

  return violations;
}

/**
 * Requirement selectors (from selected traits and active conditional
 * rules) that target `categoryId` and are not yet satisfied. A candidate
 * for that category must match every one of them.
 */
export function pendingRequirementsFor(
  categoryId: string,
  selected: readonly Trait[],
  project: LoadedProject,
): string[] {
  const pending: string[] = [];
  const collect = (requires: readonly string[]) => {
    for (const sel of requires) {
      if (selectorCategory(sel, project) === categoryId) pending.push(sel);
    }
  };
  for (const trait of selected) collect(trait.requires);
  for (const rule of activeConditionalRules(selected, project)) {
    collect(rule.requires);
  }
  return pending;
}

/** Full-set validation: pairwise rules plus unsatisfied requires. */
export function evaluateSet(
  traits: readonly Trait[],
  project: LoadedProject,
): Violation[] {
  const violations: Violation[] = [];
  for (let i = 0; i < traits.length; i++) {
    const candidate = traits[i] as Trait;
    const others = traits.filter((_, j) => j !== i);
    violations.push(...checkCandidate(candidate, others, project));
  }
  // Unsatisfied requires across the whole set
  const checkRequires = (
    owner: string,
    requires: readonly string[],
    rule: Violation['rule'],
  ) => {
    for (const sel of requires) {
      if (!traits.some((t) => traitMatchesSelector(sel, t, project))) {
        violations.push({
          rule,
          source: owner,
          target: sel,
          message: `Requirement "${sel}" from ${owner} is not satisfied`,
        });
      }
    }
  };
  for (const trait of traits) checkRequires(trait.id, trait.requires, 'requires');
  for (const rule of activeConditionalRules(traits, project)) {
    checkRequires(
      rule.name ?? rule.when.join(' + '),
      rule.requires,
      'conditional-requires',
    );
  }
  // De-duplicate (pairwise pass sees each pair twice)
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.rule}|${[v.source, v.target].sort().join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
