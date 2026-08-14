import sharp from 'sharp';
import { join } from 'node:path';
import type { LoadedProject } from '../config/loadProject.js';
import { fileExists } from '../utils/fs.js';
import { selectorCategory, selectorResolvable, traitMatchesSelector } from './selectors.js';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  trait?: string;
  asset?: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
}

/**
 * Pre-generation validation: catch every broken asset, rule, or manifest
 * problem with an actionable message before a single pixel is rendered.
 */
export async function validateProject(
  project: LoadedProject,
): Promise<ValidationReport> {
  const issues: Issue[] = [];
  const { config } = project;

  // Slots: unique ids, strictly usable ordering
  const seenSlots = new Set<string>();
  for (const slot of config.slots) {
    if (seenSlots.has(slot)) {
      issues.push({
        level: 'error',
        code: 'duplicate-slot',
        message: `Render slot "${slot}" is defined more than once`,
      });
    }
    seenSlots.add(slot);
  }

  // Categories: unique ids/names, at least one selectable trait
  const seenCategories = new Set<string>();
  for (const category of config.categories) {
    if (seenCategories.has(category.id)) {
      issues.push({
        level: 'error',
        code: 'duplicate-category',
        message: `Category id "${category.id}" is defined more than once`,
      });
    }
    seenCategories.add(category.id);
    const pool = project.byCategory.get(category.id) ?? [];
    if (pool.length === 0) {
      issues.push({
        level: 'error',
        code: 'empty-category',
        message: `Category "${category.name}" has no selectable traits`,
      });
    }
  }

  // Traits
  const namesPerCategory = new Map<string, Set<string>>();
  for (const trait of project.traits) {
    const names = namesPerCategory.get(trait.category) ?? new Set<string>();
    if (names.has(trait.name)) {
      issues.push({
        level: 'error',
        code: 'duplicate-name',
        trait: trait.id,
        message: `Duplicate public name "${trait.name}" within category "${trait.category}"`,
      });
    }
    names.add(trait.name);
    namesPerCategory.set(trait.category, names);

    if (!trait.none && trait.assets.length === 0 && trait.variants.length === 0) {
      issues.push({
        level: 'warning',
        code: 'no-assets',
        trait: trait.id,
        message: `Trait "${trait.name}" has no assets and is not a None trait`,
      });
    }

    // Family namespace must match the trait's category namespace
    if (trait.family) {
      const ns = trait.family.split(':')[0] ?? '';
      const category = project.categoryById.get(trait.category);
      const expectedNs = category?.namespace ?? category?.id;
      if (ns !== expectedNs) {
        issues.push({
          level: 'error',
          code: 'family-namespace',
          trait: trait.id,
          message: `Trait family "${trait.family}" uses namespace "${ns}" but category "${trait.category}" expects "${expectedNs}"`,
        });
      }
    }

    // Contradictory rules: requires X while blocking X
    for (const req of trait.requires) {
      if (!selectorResolvable(req, project)) {
        issues.push({
          level: 'error',
          code: 'unresolvable-requires',
          trait: trait.id,
          message: `Requirement "${req}" on "${trait.name}" matches no trait in the project`,
        });
        continue;
      }
      const reqCat = selectorCategory(req, project);
      if (reqCat) {
        const satisfiable = (project.byCategory.get(reqCat) ?? []).some(
          (t) =>
            traitMatchesSelector(req, t, project) &&
            !trait.blocks.some((b) => traitMatchesSelector(b, t, project)),
        );
        if (!satisfiable) {
          issues.push({
            level: 'error',
            code: 'contradictory-rules',
            trait: trait.id,
            message: `"${trait.name}" requires "${req}" but blocks every trait that satisfies it`,
          });
        }
      }
    }
    for (const sel of [...trait.blocks, ...trait.allows]) {
      if (!selectorResolvable(sel, project)) {
        issues.push({
          level: 'warning',
          code: 'unresolvable-selector',
          trait: trait.id,
          message: `Selector "${sel}" on "${trait.name}" matches no trait in the project`,
        });
      }
    }

    // Assets: exist, PNG, exact canvas dimensions
    const assetRefs = [
      ...trait.assets,
      ...trait.variants.flatMap((v) => v.assets),
    ];
    for (const asset of assetRefs) {
      if (!project.slotOrders.has(asset.slot)) {
        issues.push({
          level: 'error',
          code: 'unknown-slot',
          trait: trait.id,
          asset: asset.file,
          message: `Asset "${asset.file}" on "${trait.name}" uses unknown render slot "${asset.slot}"`,
        });
      }
      const full = join(project.assetsDir, asset.file);
      if (!fileExists(full)) {
        issues.push({
          level: 'error',
          code: 'missing-file',
          trait: trait.id,
          asset: asset.file,
          message: `Asset file not found: ${asset.file}`,
        });
        continue;
      }
      try {
        const meta = await sharp(full).metadata();
        if (meta.format !== 'png') {
          issues.push({
            level: 'error',
            code: 'not-png',
            trait: trait.id,
            asset: asset.file,
            message: `Asset must be PNG`,
            expected: 'png',
            actual: meta.format ?? 'unknown',
          });
        }
        if (
          meta.width !== config.canvas.width ||
          meta.height !== config.canvas.height
        ) {
          issues.push({
            level: 'error',
            code: 'wrong-dimensions',
            trait: trait.id,
            asset: asset.file,
            message: `Asset canvas mismatch`,
            expected: `${config.canvas.width}x${config.canvas.height}`,
            actual: `${meta.width}x${meta.height}`,
          });
        }
        if (!meta.hasAlpha && !trait.background) {
          issues.push({
            level: 'warning',
            code: 'no-alpha',
            trait: trait.id,
            asset: asset.file,
            message: `Non-background asset has no alpha channel`,
          });
        }
      } catch (err) {
        issues.push({
          level: 'error',
          code: 'unreadable-file',
          trait: trait.id,
          asset: asset.file,
          message: `Cannot read asset: ${(err as Error).message}`,
        });
      }
    }

    // Variant `when` keys must resolve to categories
    for (const variant of trait.variants) {
      for (const key of Object.keys(variant.when)) {
        const resolvable = key.endsWith('Family')
          ? project.categoryByNamespace.has(key.slice(0, -'Family'.length))
          : project.categoryById.has(key) || project.categoryByName.has(key);
        if (!resolvable) {
          issues.push({
            level: 'error',
            code: 'unresolvable-variant',
            trait: trait.id,
            message: `Variant condition key "${key}" on "${trait.name}" resolves to no category`,
          });
        }
      }
    }
  }

  // Rules file selectors
  for (const group of project.rules.exclusiveGroups) {
    for (const member of group.members) {
      if (!selectorResolvable(member, project)) {
        issues.push({
          level: 'warning',
          code: 'unresolvable-selector',
          message: `Exclusive group "${group.name}" member "${member}" matches no trait`,
        });
      }
    }
  }
  for (const rule of [...project.rules.conditional, ...project.rules.synergies]) {
    for (const sel of rule.when) {
      if (!selectorResolvable(sel, project)) {
        issues.push({
          level: 'warning',
          code: 'unresolvable-selector',
          message: `Rule "${rule.name ?? sel}" selector "${sel}" matches no trait`,
        });
      }
    }
  }

  // Fixed editions reference real traits
  for (const fixed of config.fixedEditions) {
    for (const [categoryId, traitId] of Object.entries(fixed.traits)) {
      if (!project.categoryById.has(categoryId)) {
        issues.push({
          level: 'error',
          code: 'fixed-edition',
          message: `Fixed edition ${fixed.edition} references unknown category "${categoryId}"`,
        });
      }
      const trait = project.traitById.get(traitId);
      if (!trait) {
        issues.push({
          level: 'error',
          code: 'fixed-edition',
          message: `Fixed edition ${fixed.edition} references unknown trait "${traitId}"`,
        });
      } else if (trait.category !== categoryId) {
        issues.push({
          level: 'error',
          code: 'fixed-edition',
          message: `Fixed edition ${fixed.edition}: trait "${traitId}" does not belong to category "${categoryId}"`,
        });
      }
    }
  }

  return {
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}

export function formatIssue(issue: Issue): string {
  const parts = [
    `${issue.level.toUpperCase()} [${issue.code}]`,
    issue.trait ? `Trait: ${issue.trait}` : null,
    issue.asset ? `Asset: ${issue.asset}` : null,
    issue.message,
    issue.expected ? `Expected: ${issue.expected}` : null,
    issue.actual ? `Actual: ${issue.actual}` : null,
  ];
  return parts.filter(Boolean).join('\n  ');
}
