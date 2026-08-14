import { z } from 'zod';

/**
 * TRAIT vs ASSET vs RENDER SLOT
 * ------------------------------
 * A TRAIT is what collectors see in metadata ("Headwear = Black Cap").
 * An ASSET is one PNG required to render that trait (black-cap-back.png).
 * A RENDER SLOT is the compositor position an asset is drawn into
 * (210_HEADWEAR_BEHIND). One trait may own any number of assets across
 * any number of slots — the split is invisible in public metadata.
 */

export const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
]);
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const AssetRefSchema = z.object({
  /** Render slot id, must exist in the project slot list. */
  slot: z.string().min(1),
  /** File path relative to the project assets/ directory. */
  file: z.string().min(1),
  opacity: z.number().min(0).max(1).optional(),
  blend: BlendModeSchema.optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const RaritySchema = z.object({
  weight: z.number().positive(),
  tier: z.string().optional(),
  /** Minimum desired occurrences across a build (reported, best-effort). */
  min: z.number().int().nonnegative().nullish(),
  /** Hard cap on occurrences across a build. */
  max: z.number().int().positive().nullish(),
  /** Exact target occurrences (enforced as max, verified after build). */
  exact: z.number().int().positive().nullish(),
});
export type Rarity = z.infer<typeof RaritySchema>;

export const TraitPaletteSchema = z.object({
  primary: z.string().optional(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  temperature: z.enum(['cool', 'warm', 'neutral']).optional(),
});
export type TraitPalette = z.infer<typeof TraitPaletteSchema>;

export const BackgroundInfoSchema = z.object({
  /** Relative luminance 0..1 of the solid background color. */
  luminance: z.number().min(0).max(1),
  family: z.string().optional(),
  temperature: z.enum(['cool', 'warm', 'neutral']).optional(),
  hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
});
export type BackgroundInfo = z.infer<typeof BackgroundInfoSchema>;

/**
 * Contextual variant: swap the rendered asset set when the surrounding
 * combination matches. `when` keys are either a category id ("clothing")
 * or "<namespace>Family" ("clothingFamily"); values match the selected
 * trait's id, name, or family value in that category.
 */
export const VariantSchema = z.object({
  when: z.record(z.string(), z.string()),
  assets: z.array(AssetRefSchema),
});
export type Variant = z.infer<typeof VariantSchema>;

export const TraitSchema = z.object({
  /** Canonical id, used for DNA. snake_case, globally unique. */
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** Category id this trait belongs to. */
  category: z.string().min(1),
  /** Public collector-facing name emitted in NFT metadata. */
  name: z.string().min(1),
  /** True for first-class "None" traits (no assets required). */
  none: z.boolean().default(false),
  /** Shorthand for rarity.weight when no other rarity fields are needed. */
  weight: z.number().positive().optional(),
  rarity: RaritySchema.optional(),
  tags: z.array(z.string()).default([]),
  /** Family token "namespace:value" (e.g. "headwear:cap", "growth:rear"). */
  family: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/).optional(),
  palette: TraitPaletteSchema.optional(),
  /** Background-only color metadata for contrast-aware selection. */
  background: BackgroundInfoSchema.optional(),
  assets: z.array(AssetRefSchema).default([]),
  variants: z.array(VariantSchema).default([]),
  /**
   * Compatibility selectors. Grammar (shared by allows/blocks/requires,
   * exclusive groups, conditional rules, and synergies):
   *   trait:<id>              exact trait
   *   tag:<tag>               any trait carrying the tag
   *   category:<categoryId>   any trait of the category
   *   <namespace>:<value>     family selector ("growth:rear", "growth:none")
   *   <Category Name>:<Name>  public name selector ("Headwear:Black Cap")
   */
  allows: z.array(z.string()).default([]),
  blocks: z.array(z.string()).default([]),
  requires: z.array(z.string()).default([]),
});
export type Trait = z.infer<typeof TraitSchema>;

export function traitWeight(trait: Trait): number {
  return trait.rarity?.weight ?? trait.weight ?? 100;
}
