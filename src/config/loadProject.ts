import { join, resolve } from 'node:path';
import { fileExists, listFiles, readJson } from '../utils/fs.js';
import {
  ProjectConfigSchema,
  slotOrder,
  type Category,
  type ProjectConfig,
} from '../schemas/project.js';
import { RulesFileSchema, EMPTY_RULES, type RulesFile } from '../schemas/rules.js';
import { TraitSchema, type Trait } from '../schemas/trait.js';

export interface LoadedProject {
  dir: string;
  assetsDir: string;
  config: ProjectConfig;
  rules: RulesFile;
  traits: Trait[];
  traitById: Map<string, Trait>;
  byCategory: Map<string, Trait[]>;
  categoryById: Map<string, Category>;
  categoryByName: Map<string, Category>;
  categoryByNamespace: Map<string, Category>;
  /** slot id -> numeric z-order */
  slotOrders: Map<string, number>;
  /** categories in selection order (selectAfterCharacter last) */
  selectionOrder: Category[];
  /** categories in metadata/stage order */
  categoryOrder: Category[];
}

export class ProjectLoadError extends Error {}

export function loadProject(projectDir: string): LoadedProject {
  const dir = resolve(projectDir);
  const configPath = join(dir, 'project.json');
  if (!fileExists(configPath)) {
    throw new ProjectLoadError(`No project.json found in ${dir}`);
  }

  const config = parseWith(ProjectConfigSchema, readJson(configPath), configPath);

  const rulesPath = join(dir, 'rules', 'rules.json');
  const rules = fileExists(rulesPath)
    ? parseWith(RulesFileSchema, readJson(rulesPath), rulesPath)
    : EMPTY_RULES;

  const traitFiles = listFiles(join(dir, 'traits'), '.json');
  const traits: Trait[] = traitFiles.map((file) =>
    parseWith(TraitSchema, readJson(file), file),
  );
  // Deterministic ordering regardless of filesystem enumeration.
  traits.sort((a, b) => a.id.localeCompare(b.id));

  const traitById = new Map<string, Trait>();
  for (const trait of traits) {
    if (traitById.has(trait.id)) {
      throw new ProjectLoadError(`Duplicate trait id: ${trait.id}`);
    }
    traitById.set(trait.id, trait);
  }

  const categoryById = new Map<string, Category>();
  const categoryByName = new Map<string, Category>();
  const categoryByNamespace = new Map<string, Category>();
  for (const category of config.categories) {
    categoryById.set(category.id, category);
    categoryByName.set(category.name, category);
    categoryByNamespace.set(category.namespace ?? category.id, category);
  }

  const byCategory = new Map<string, Trait[]>();
  for (const category of config.categories) byCategory.set(category.id, []);
  for (const trait of traits) {
    const bucket = byCategory.get(trait.category);
    if (!bucket) {
      throw new ProjectLoadError(
        `Trait ${trait.id} references unknown category "${trait.category}"`,
      );
    }
    bucket.push(trait);
  }

  const slotOrders = new Map<string, number>();
  for (const slot of config.slots) slotOrders.set(slot, slotOrder(slot));

  const categoryOrder = [...config.categories].sort((a, b) => a.order - b.order);
  const selectionOrder = [
    ...categoryOrder.filter((c) => !c.selectAfterCharacter),
    ...categoryOrder.filter((c) => c.selectAfterCharacter),
  ];

  return {
    dir,
    assetsDir: join(dir, 'assets'),
    config,
    rules,
    traits,
    traitById,
    byCategory,
    categoryById,
    categoryByName,
    categoryByNamespace,
    slotOrders,
    selectionOrder,
    categoryOrder,
  };
}

function parseWith<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
  file: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProjectLoadError(
      `Invalid config in ${file}:\n${String(result.error)}`,
    );
  }
  return result.data as T;
}
