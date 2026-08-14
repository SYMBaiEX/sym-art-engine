import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';

export interface PaletteEvaluation {
  /** 0..100. Higher = better silhouette readability + color harmony. */
  score: number;
  /** |background luminance - weighted character luminance| (0..1). */
  contrast: number;
  blocked: string[];
  discouraged: string[];
  preferred: string[];
  notes: string[];
}

const ROLE_WEIGHTS = { primary: 0.6, secondary: 0.25, accent: 0.15 } as const;

/**
 * Contrast + relationship scoring between the selected background and the
 * character's hidden trait palettes. Prevents e.g. black character on
 * black clothing on black background from destroying the silhouette.
 */
export function evaluatePalette(
  traits: readonly Trait[],
  project: LoadedProject,
): PaletteEvaluation {
  const rules = project.rules.palette;
  const notes: string[] = [];
  const background = traits.find((t) => t.background);

  // Weighted average character luminance from named palette colors.
  let lumSum = 0;
  let lumWeight = 0;
  for (const trait of traits) {
    if (!trait.palette || trait.background) continue;
    for (const role of ['primary', 'secondary', 'accent'] as const) {
      const colorName = trait.palette[role];
      if (!colorName) continue;
      const color = rules.colors[colorName];
      if (!color) {
        notes.push(`Unknown palette color "${colorName}" on ${trait.id}`);
        continue;
      }
      lumSum += color.luminance * ROLE_WEIGHTS[role];
      lumWeight += ROLE_WEIGHTS[role];
    }
  }

  if (!background?.background || lumWeight === 0) {
    return {
      score: 75,
      contrast: 0,
      blocked: [],
      discouraged: [],
      preferred: [],
      notes: [...notes, 'No background metadata or trait palettes — neutral score'],
    };
  }

  const characterLuminance = lumSum / lumWeight;
  const contrast = Math.abs(background.background.luminance - characterLuminance);

  let score = Math.min(1, contrast / rules.targetContrast) * 100;

  const blocked: string[] = [];
  const discouraged: string[] = [];
  const preferred: string[] = [];
  const bgFamily = background.background.family ?? 'unknown';
  const bgTemp = background.background.temperature;

  const traitTokens = new Set<string>();
  for (const trait of traits) {
    if (!trait.palette || trait.background) continue;
    for (const role of ['primary', 'secondary', 'accent'] as const) {
      const colorName = trait.palette[role];
      if (colorName) traitTokens.add(colorName);
    }
    if (trait.palette.temperature) traitTokens.add(`temp:${trait.palette.temperature}`);
  }

  for (const rel of rules.relationships) {
    const bgMatch =
      rel.background === bgFamily ||
      (bgTemp !== undefined && rel.background === `temp:${bgTemp}`);
    if (!bgMatch || !traitTokens.has(rel.trait)) continue;
    const label = `${rel.background} × ${rel.trait}`;
    if (rel.level === 'blocked') {
      blocked.push(label);
      score = 0;
    } else if (rel.level === 'discouraged') {
      discouraged.push(label);
      score -= 15;
    } else if (rel.level === 'preferred') {
      preferred.push(label);
      score += 10;
    }
  }

  if (rules.minContrast > 0 && contrast < rules.minContrast) {
    blocked.push(
      `contrast ${contrast.toFixed(3)} below minimum ${rules.minContrast}`,
    );
    score = 0;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    contrast,
    blocked,
    discouraged,
    preferred,
    notes,
  };
}
