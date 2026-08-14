import { z } from 'zod';

export const CategorySchema = z.object({
  /** Stable id ("headwear"). Used in DNA, rules, and file layout. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Public metadata trait_type ("Headwear", "Ear / Side Accessory"). */
  name: z.string().min(1),
  /** Family namespace for this category (defaults to id). */
  namespace: z.string().optional(),
  /** Metadata + cumulative-stage order. */
  order: z.number().int(),
  /** Optional categories may resolve to a None trait. */
  optional: z.boolean().default(false),
  /** Emit "None" values in public metadata for this category. */
  emitNoneInMetadata: z.boolean().default(true),
  /** Include "None" selections in canonical DNA for this category. */
  includeNoneInDna: z.boolean().default(true),
  /**
   * Select this category after all character traits, so palette/contrast
   * rules can see the finished character (backgrounds).
   */
  selectAfterCharacter: z.boolean().default(false),
});
export type Category = z.infer<typeof CategorySchema>;

export const MetadataConfigSchema = z.object({
  nameTemplate: z.string().default('#{editionPadded}'),
  descriptionTemplate: z.string().default(''),
  imageTemplate: z.string().default('ipfs://PLACEHOLDER/{editionPadded}.png'),
  editionPadding: z.number().int().min(1).default(4),
  externalUrl: z.string().optional(),
});
export type MetadataConfig = z.infer<typeof MetadataConfigSchema>;

export const GenerationConfigSchema = z.object({
  /** Max attempts per edition before the build aborts. */
  maxRerolls: z.number().int().positive().default(250),
  allowDuplicates: z.boolean().default(false),
  /** Reroll combinations whose palette score falls below this (0..100). */
  paletteRerollBelow: z.number().min(0).max(100).nullish(),
  /** Reroll combinations whose synergy score falls below this. */
  synergyRerollBelow: z.number().nullish(),
});
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;

export const FixedEditionSchema = z.object({
  edition: z.number().int().positive(),
  /** categoryId -> traitId */
  traits: z.record(z.string(), z.string()),
});
export type FixedEdition = z.infer<typeof FixedEditionSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().default(''),
  projectVersion: z.string().default('0.1.0'),
  /** Engine major version this project targets (e.g. "0.1"). */
  engineVersion: z.string().default('0.1'),
  traitSchemaVersion: z.string().default('1'),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /**
   * Ordered render slots, "NNN_NAME". The numeric prefix defines z-order
   * (low = drawn first / bottom). Spacing is intentional so new slots can
   * be inserted without restructuring. Slots are project data — the
   * compositor never hard-codes them.
   */
  slots: z.array(z.string().regex(/^\d+_[A-Z0-9_]+$/)).min(1),
  categories: z.array(CategorySchema).min(1),
  metadata: MetadataConfigSchema.prefault({}),
  generation: GenerationConfigSchema.prefault({}),
  /** Deterministic hand-authored editions (e.g. Symbie #0001). */
  fixedEditions: z.array(FixedEditionSchema).default([]),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function slotOrder(slotId: string): number {
  return parseInt(slotId.split('_')[0] ?? '0', 10);
}
