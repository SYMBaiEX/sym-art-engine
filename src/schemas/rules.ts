import { z } from 'zod';

/** At most one selected trait may match the members of an exclusive group. */
export const ExclusiveGroupSchema = z.object({
  name: z.string().min(1),
  members: z.array(z.string()).min(2),
});
export type ExclusiveGroup = z.infer<typeof ExclusiveGroupSchema>;

/**
 * Conditional rule: once every `when` selector is matched by the selected
 * traits, the rule's blocks/allows/requires apply to the rest of the
 * combination — data-driven, no collection logic in engine code.
 */
export const ConditionalRuleSchema = z.object({
  name: z.string().optional(),
  when: z.array(z.string()).min(1),
  blocks: z.array(z.string()).default([]),
  allows: z.array(z.string()).default([]),
  requires: z.array(z.string()).default([]),
});
export type ConditionalRule = z.infer<typeof ConditionalRuleSchema>;

/** Positive synergy: all `when` selectors matched -> add `score`. */
export const SynergyRuleSchema = z.object({
  name: z.string().optional(),
  when: z.array(z.string()).min(2),
  score: z.number(),
});
export type SynergyRule = z.infer<typeof SynergyRuleSchema>;

export const PaletteColorSchema = z.object({
  hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
  luminance: z.number().min(0).max(1),
  temperature: z.enum(['cool', 'warm', 'neutral']).optional(),
});

/**
 * Palette relationship between the selected background family and a
 * trait palette color name (or temperature token "temp:warm").
 */
export const PaletteRelationshipSchema = z.object({
  background: z.string().min(1),
  trait: z.string().min(1),
  level: z.enum(['preferred', 'allowed', 'discouraged', 'blocked']),
});
export type PaletteRelationship = z.infer<typeof PaletteRelationshipSchema>;

export const PaletteRulesSchema = z.object({
  /** Named colors traits reference in their palette metadata. */
  colors: z.record(z.string(), PaletteColorSchema).default({}),
  /** Hard floor: |bgLuminance - characterLuminance| must exceed this. */
  minContrast: z.number().min(0).max(1).default(0),
  /** Luminance delta that maps to a full contrast score. */
  targetContrast: z.number().min(0.01).max(1).default(0.35),
  relationships: z.array(PaletteRelationshipSchema).default([]),
});
export type PaletteRules = z.infer<typeof PaletteRulesSchema>;

export const RulesFileSchema = z.object({
  exclusiveGroups: z.array(ExclusiveGroupSchema).default([]),
  conditional: z.array(ConditionalRuleSchema).default([]),
  synergies: z.array(SynergyRuleSchema).default([]),
  palette: PaletteRulesSchema.prefault({}),
});
export type RulesFile = z.infer<typeof RulesFileSchema>;

export const EMPTY_RULES: RulesFile = RulesFileSchema.parse({});
