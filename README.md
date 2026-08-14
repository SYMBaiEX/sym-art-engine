# SYM Art Engine

A deterministic, rule-driven generative PFP engine built for sophisticated
layered NFT collections — the permanent generator infrastructure for
**SYMBIES**, **OROCHIS**, and every SYMBaiEX collection after them.

SYM Art Engine is an original engine. It borrows proven *concepts* from the
generative-art space (ordered layers, weighted rarity, DNA uniqueness,
metadata generation — see [Acknowledgments](#acknowledgments)) and adds the
parts basic engines lack: trait compatibility, multi-part traits, palette
synergy, validation, deterministic builds, visual QA tooling, and a
first-class preview/debug UI.

## Philosophy

1. **Traits ≠ assets ≠ render slots.** Collectors see traits. The
   compositor sees assets placed into slots. The engine never conflates
   the three.
2. **Everything is data.** Slots, categories, rules, synergies, palettes —
   all project configuration. The engine contains zero collection-specific
   logic; `projects/orochis` needs no engine changes.
3. **Determinism is sacred.** Same project + assets + seed + engine version
   ⇒ same collection, byte for byte. Every build writes a manifest with
   config/trait/asset hashes so builds are reproducible and auditable.
4. **Fail before pixels.** The validator catches broken files, contradictory
   rules, and dead-end pools with actionable errors before any rendering.

## Core concepts

### Trait
What collectors see in NFT metadata: `Headwear = Black Cap`. Defined by a
JSON manifest in `projects/<slug>/traits/`.

### Asset
One PNG needed to render a trait. A single trait may own many assets at
different depths — `black-cap-back.png` + `black-cap-front.png` remain ONE
public trait. Metadata never leaks the split.

### Render slot
A compositor position: `210_HEADWEAR_BEHIND`, `1000_HEADWEAR_FRONT`. Slots
are declared per-project with numeric prefixes defining z-order; the gaps
(000, 100, 200…) are intentional so new slots can be inserted without
restructuring anything.

```
1100_SPECIAL_FRONT      (top)
1010_GROWTH_FRONT
1000_HEADWEAR_FRONT
 910_NECK_FRONT
 900_CLOTHING_FRONT
 800_EAR_ACCESSORY_FRONT
 710_FOREHEAD_MARK
 700_EYES
 600_GROWTH_MIDDLE
 500_HEAD_DETAILS
 410_NECK_BEHIND
 400_CLOTHING_BEHIND
 300_BODY
 220_EAR_ACCESSORY_BEHIND
 210_HEADWEAR_BEHIND
 200_GROWTH_BEHIND
 100_SPECIAL_BEHIND
 000_BACKGROUND          (bottom)
```

## Project layout

```
projects/<slug>/
├── project.json        # canvas, slots, categories, metadata, generation
├── traits/**/*.json    # one manifest per trait
├── rules/rules.json    # exclusive groups, conditional rules, synergies, palette
├── assets/**/*.png     # 2000x2000 RGBA layers referenced by manifests
└── art-specs/          # what production artwork must satisfy
```

### Trait manifest

```json
{
  "id": "headwear_black_cap",
  "category": "headwear",
  "name": "Black Cap",
  "family": "headwear:cap",
  "tags": ["casual", "streetwear", "black", "standard-fit"],
  "rarity": { "weight": 100, "tier": "common", "max": null },
  "palette": { "primary": "black", "accent": "purple" },
  "assets": [
    { "slot": "210_HEADWEAR_BEHIND", "file": "headwear/black-cap-back.png" },
    { "slot": "1000_HEADWEAR_FRONT", "file": "headwear/black-cap-front.png" }
  ],
  "allows": ["growth:none", "growth:rear", "growth:side-small"],
  "blocks": ["growth:crown-large", "growth:full-skull"]
}
```

### Selector grammar

Used everywhere rules reference traits (allows/blocks/requires, exclusive
groups, conditional rules, synergies):

| Selector | Matches |
|---|---|
| `trait:<id>` | exact trait id |
| `tag:<tag>` | any trait carrying the tag |
| `category:<id>` | any trait of a category |
| `<namespace>:<value>` | family, e.g. `growth:rear` (`growth:none` matches None) |
| `<Category Name>:<Name>` | public names, e.g. `Headwear:Black Cap` |

### Compatibility rules

- `blocks` — hard exclusion, enforced both directions.
- `allows` — scoped allow-list: grouped by the category each selector
  resolves to; a candidate inside a scoped category must match the list.
- `requires` — must be satisfied by an already-selected trait, or becomes a
  pending constraint on later categories.
- `exclusiveGroups` (rules.json) — at most one selected trait may match a
  group's members.
- `conditional` (rules.json) — when every `when` selector matches, the
  rule's blocks/allows/requires activate. Fully data-driven (`Hood Up →
  restrict Head Growth` lives in project data, not engine code).

### Synergy + palette

`synergies` award scores to combinations that work well together; the
generator records the score per edition and can optionally reroll below a
threshold (`generation.synergyRerollBelow`). Palette rules give every trait
hidden color metadata, score background/character contrast, apply
preferred/allowed/discouraged/blocked relationships, and can hard-block
silhouette-killing combos (black character × black background).

### Variants

Traits can swap asset sets by context — the same public trait rendered
differently over a hoodie vs a tee:

```json
"variants": [
  { "when": { "clothingFamily": "hoodie" },
    "assets": [{ "slot": "910_NECK_FRONT", "file": "neck/sym-chain__hoodie.png" }] }
]
```

### None traits

First-class: `"none": true`, weighted like any trait, with per-category
config for whether None appears in metadata (`emitNoneInMetadata`) and DNA
(`includeNoneInDna`).

### Rarity

Weights live in manifests (never filenames): raw `weight`, `tier` labels,
`min`/`max`/`exact` occurrence targets. `max`/`exact` are enforced during
generation; `min`/`exact` are verified in the post-build report.

### DNA

Canonical DNA is `categoryId=traitId` lines in category order (IDs, never
filenames), SHA-256 hashed. Duplicates are rejected and rerolled unless
`generation.allowDuplicates` is set. Output images are also hashed as a
secondary duplicate check.

## CLI

```bash
cd packages/sym-art-engine

bun run sym -- validate symbies                # full pre-flight validation
bun run sym -- render symbies --edition 1      # one edition PNG + metadata
bun run sym -- stages symbies --edition 1      # cumulative + isolated previews
bun run sym -- generate symbies --count 1000 --seed SYMBIES_GENESIS
bun run sym -- generate symbies --count 10000 --seed X --dry-run   # no rendering
bun run sym -- analyze symbies --count 5000    # distribution simulation
bun run sym -- dna symbies --edition 1         # canonical DNA + hash
bun run sym -- studio symbies                  # combination explorer UI
bun run sym -- preview symbies                 # one random legal edition

# asset pipeline utilities
bun run sym -- tools solid|key|extract|normalize|hash
```

(Also exposed as npm scripts at the monorepo root: `bun run validate`,
`bun run stages`, `bun run studio`, …. `npx`/`node` work equally — the CLI
is plain Node + tsx.)

Fixed editions (e.g. Symbie #0001) are declared in `project.json →
fixedEditions` and always resolve identically regardless of seed.

## Generation pipeline

```
load project → validate → seeded RNG → select per category
→ compatibility state → hard rules → synergy → palette
→ optional reroll → canonical DNA → duplicate check
→ resolve variants → render plan → composite → image QA
→ metadata → reports → build manifest
```

`--dry-run` executes everything up to (not including) compositing —
useful for verifying a 10k build's distributions and dead ends in seconds.

## Outputs

```
output/<slug>/
├── images/0001.png
├── metadata/0001.json          # ERC-721 metadata, one attribute per category
├── stages/01-background.png…   # cumulative build-up previews
├── previews/isolated/*.png     # per-trait layers over checkerboard
├── reports/collection-report.{json,html}   # counts, %, rejections,
│                               # synergy/palette distributions, rarity
│                               # warnings, co-occurrence matrix
├── reports/debug/0001.json     # internal per-edition debug (never public)
└── build-manifest.json         # seed, hashes, versions — reproducibility
```

## SYM Studio

`bun run sym -- studio symbies` → http://localhost:4477

- pick any trait per category, live composite preview
- cumulative vs isolated (checkerboard) view
- compatibility violations, blocked options with reasons, synergy chips,
  palette scores, overall combination score
- render-stack debugger: every slot with file, source trait, opacity,
  blend, and a visibility toggle
- randomize (optionally seeded), save full-res preview, inspect metadata + DNA

## Tests

```bash
bun run test          # vitest
```

44 tests cover PRNG/DNA determinism, weighted selection, every rule type,
None traits, multi-asset traits, variants, palette scoring, duplicate
prevention, metadata, slot ordering, dimension validation, dry-run, and a
golden test pinning Symbie #0001's DNA, metadata, and render reproducibility.

## Acknowledgments

The [HashLips Art Engine](https://github.com/HashLips/hashlips_art_engine)
(MIT) popularized the fundamentals this generation of tooling builds on —
ordered PNG layers, weighted rarity, DNA-based duplicate prevention, layer
configurations, and rarity reporting. SYM Art Engine shares those concepts
but is an independent, clean-room implementation with a different
architecture; no HashLips code is included.
