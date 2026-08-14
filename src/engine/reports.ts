import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';

export interface EditionRecord {
  edition: number;
  dna: string;
  /** categoryId -> traitId */
  traits: Record<string, string>;
  synergyScore: number;
  paletteScore: number;
  rerolls: number;
}

export interface BuildStats {
  requested: number;
  generated: number;
  rejected: Record<string, number>;
  totalRerolls: number;
  durationMs: number;
}

export interface CollectionReport {
  project: string;
  seed: string;
  dryRun: boolean;
  stats: BuildStats;
  traitCounts: Record<string, Record<string, { count: number; percent: number; tier?: string }>>;
  synergyDistribution: Record<string, number>;
  paletteDistribution: Record<string, number>;
  rarityWarnings: string[];
  coOccurrence: { a: string; b: string; count: number; percent: number }[];
}

export function buildCollectionReport(
  project: LoadedProject,
  editions: readonly EditionRecord[],
  stats: BuildStats,
  seed: string,
  dryRun: boolean,
): CollectionReport {
  const total = editions.length || 1;

  const traitCounts: CollectionReport['traitCounts'] = {};
  for (const category of project.categoryOrder) {
    traitCounts[category.name] = {};
    for (const trait of project.byCategory.get(category.id) ?? []) {
      traitCounts[category.name]![trait.name] = {
        count: 0,
        percent: 0,
        ...(trait.rarity?.tier ? { tier: trait.rarity.tier } : {}),
      };
    }
  }
  for (const edition of editions) {
    for (const [categoryId, traitId] of Object.entries(edition.traits)) {
      const category = project.categoryById.get(categoryId);
      const trait = project.traitById.get(traitId);
      if (!category || !trait) continue;
      const entry = traitCounts[category.name]?.[trait.name];
      if (entry) entry.count += 1;
    }
  }
  for (const category of Object.values(traitCounts)) {
    for (const entry of Object.values(category)) {
      entry.percent = Math.round((entry.count / total) * 10000) / 100;
    }
  }

  const synergyDistribution: Record<string, number> = {};
  const paletteDistribution: Record<string, number> = {};
  for (const edition of editions) {
    const sKey = String(edition.synergyScore);
    synergyDistribution[sKey] = (synergyDistribution[sKey] ?? 0) + 1;
    const pKey = `${Math.floor(edition.paletteScore / 10) * 10}-${Math.floor(edition.paletteScore / 10) * 10 + 9}`;
    paletteDistribution[pKey] = (paletteDistribution[pKey] ?? 0) + 1;
  }

  // Rarity min/exact verification
  const rarityWarnings: string[] = [];
  const occurrence = new Map<string, number>();
  for (const edition of editions) {
    for (const traitId of Object.values(edition.traits)) {
      occurrence.set(traitId, (occurrence.get(traitId) ?? 0) + 1);
    }
  }
  for (const trait of project.traits) {
    const count = occurrence.get(trait.id) ?? 0;
    if (trait.rarity?.exact != null && count !== trait.rarity.exact) {
      rarityWarnings.push(
        `${trait.id}: exact occurrence target ${trait.rarity.exact}, actual ${count}`,
      );
    } else if (trait.rarity?.min != null && count < trait.rarity.min) {
      rarityWarnings.push(
        `${trait.id}: min occurrence target ${trait.rarity.min}, actual ${count}`,
      );
    }
  }

  // Cross-category co-occurrence counts (unordered trait pairs)
  const pairCounts = new Map<string, number>();
  for (const edition of editions) {
    const ids = Object.values(edition.traits).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const coOccurrence = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|') as [string, string];
      return {
        a: project.traitById.get(a)?.name ?? a,
        b: project.traitById.get(b)?.name ?? b,
        count,
        percent: Math.round((count / total) * 10000) / 100,
      };
    })
    .sort((x, y) => y.count - x.count);

  return {
    project: project.config.slug,
    seed,
    dryRun,
    stats,
    traitCounts,
    synergyDistribution,
    paletteDistribution,
    rarityWarnings,
    coOccurrence,
  };
}

export function reportToHtml(report: CollectionReport): string {
  const esc = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const section = (title: string, body: string) =>
    `<section><h2>${esc(title)}</h2>${body}</section>`;

  const traitRows = Object.entries(report.traitCounts)
    .map(([category, traits]) => {
      const rows = Object.entries(traits)
        .sort((a, b) => b[1].count - a[1].count)
        .map(
          ([name, e]) =>
            `<tr><td>${esc(name)}</td><td>${e.count}</td><td>${e.percent}%</td><td>${esc(e.tier ?? '')}</td></tr>`,
        )
        .join('');
      return `<h3>${esc(category)}</h3><table><tr><th>Trait</th><th>Count</th><th>%</th><th>Tier</th></tr>${rows}</table>`;
    })
    .join('');

  const rejectRows = Object.entries(report.stats.rejected)
    .map(([reason, count]) => `<tr><td>${esc(reason)}</td><td>${count}</td></tr>`)
    .join('');

  const coRows = report.coOccurrence
    .slice(0, 100)
    .map(
      (p) =>
        `<tr><td>${esc(p.a)}</td><td>${esc(p.b)}</td><td>${p.count}</td><td>${p.percent}%</td></tr>`,
    )
    .join('');

  const synergyRows = Object.entries(report.synergyDistribution)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([score, count]) => `<tr><td>${esc(score)}</td><td>${count}</td></tr>`)
    .join('');

  const paletteRows = Object.entries(report.paletteDistribution)
    .sort()
    .map(([bucket, count]) => `<tr><td>${esc(bucket)}</td><td>${count}</td></tr>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.project)} collection report</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:960px;margin:2rem auto;padding:0 1rem}
h1{color:#a78bfa}h2{color:#c4b5fd;border-bottom:1px solid #333;padding-bottom:.3rem}
table{border-collapse:collapse;margin:.5rem 0 1.5rem;width:100%}
td,th{border:1px solid #333;padding:.3rem .6rem;text-align:left;font-size:.9rem}
th{background:#1e1b2e}code{color:#a78bfa}
</style></head><body>
<h1>${esc(report.project)} — collection report</h1>
<p>Seed: <code>${esc(report.seed)}</code> · ${report.dryRun ? 'DRY RUN' : 'full build'} ·
Generated ${report.stats.generated}/${report.stats.requested} ·
Rerolls ${report.stats.totalRerolls} · ${report.stats.durationMs}ms</p>
${section('Trait distribution', traitRows)}
${section('Rejections', `<table><tr><th>Reason</th><th>Count</th></tr>${rejectRows || '<tr><td colspan="2">none</td></tr>'}</table>`)}
${section('Synergy score distribution', `<table><tr><th>Score</th><th>Editions</th></tr>${synergyRows}</table>`)}
${section('Palette score distribution', `<table><tr><th>Bucket</th><th>Editions</th></tr>${paletteRows}</table>`)}
${section('Rarity target warnings', `<ul>${report.rarityWarnings.map((w) => `<li>${esc(w)}</li>`).join('') || '<li>none</li>'}</ul>`)}
${section('Top trait co-occurrence', `<table><tr><th>Trait A</th><th>Trait B</th><th>Count</th><th>%</th></tr>${coRows}</table>`)}
</body></html>`;
}

export function traitRecord(
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const category of project.categoryOrder) {
    const trait = selected.get(category.id);
    if (trait) record[category.id] = trait.id;
  }
  return record;
}
