# SYM Art Engine

SYM Art Engine is a deterministic, rule-driven generator for layered NFT and
generative-art collections. It turns project-owned manifests and PNG layers
into reproducible images, ERC-721 metadata, distribution reports, and build
manifests. The package contains no collection art or collection-specific rules.

## Install

```bash
npm install sym-art-engine
# or
bun add sym-art-engine
```

The CLI accepts an explicit path to your project. This is the recommended form
for scripts and CI:

```bash
npx sym validate /absolute/path/to/my-collection
npx sym generate /absolute/path/to/my-collection --count 100 --seed launch-2026
```

For local experimentation, a project name also resolves beneath the current
directory's `projects/` folder:

```bash
sym preview example-collection
# resolves ./projects/example-collection/project.json
```

## Project layout

```text
my-collection/
├── project.json        # canvas, render slots, metadata, generation options
├── traits/**/*.json    # one public trait manifest per file
├── rules/rules.json    # compatibility, synergies, palette rules
└── assets/**/*.png     # project-owned layers referenced by manifests
```

Outputs default to `my-collection/output/`; use `--out <directory>` to choose
another location. Project data and generated outputs are deliberately not
included in this package.

## CLI

```bash
sym validate /path/to/project
sym render /path/to/project --edition 1 --seed preview
sym stages /path/to/project --edition 1
sym generate /path/to/project --count 1000 --seed collection-v1
sym generate /path/to/project --count 10000 --seed collection-v1 --dry-run
sym analyze /path/to/project --count 5000
sym dna /path/to/project --edition 1
sym studio /path/to/project
sym preview /path/to/project

# Optional image-pipeline utilities
sym tools key --in input.png --out layer.png --color ff00ff
sym tools extract --prev stage-1.png --next stage-2.png --out layer.png
sym tools normalize --in input.png --out layer.png --width 2000 --height 2000
```

`generate --dry-run` evaluates selection, compatibility, DNA uniqueness, and
distribution rules without writing images. Use it before a full render.

## Trait model

A **trait** is collector-facing metadata. An **asset** is a PNG layer. A trait
can own multiple assets in different render slots without exposing that split in
metadata.

```json
{
  "id": "headwear_black_cap",
  "category": "headwear",
  "name": "Black Cap",
  "family": "headwear:cap",
  "rarity": { "weight": 100, "tier": "common" },
  "assets": [
    { "slot": "210_HEADWEAR_BEHIND", "file": "headwear/cap-back.png" },
    { "slot": "1000_HEADWEAR_FRONT", "file": "headwear/cap-front.png" }
  ],
  "allows": ["growth:none", "growth:rear"]
}
```

Slots use numeric prefixes for z-order. Rules support exact trait IDs, tags,
categories, family selectors, and public `Category:Name` selectors. The engine
validates broken references, incompatible traits, invalid dimensions, and
dead-end selection pools before rendering.

## Library use

```ts
import { generateCollection, loadProject, validateProject } from 'sym-art-engine';

const project = loadProject('/absolute/path/to/my-collection');
const validation = await validateProject(project);
if (validation.errors.length) throw new Error('Project is not ready to render');

await generateCollection(project, {
  count: 100,
  seed: 'collection-v1',
  outDir: '/absolute/path/to/my-collection/output',
});
```

## Development

Requires Bun 1.4+ and Node.js 22.12+.

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
npm pack --dry-run
```

The test suite uses a synthetic fixture only; no collection assets or metadata
are required. `npm pack --dry-run` is the release boundary: inspect it before
publishing to ensure the tarball contains only `dist/` and the public project
documents.

## Security and support

Report security issues privately as described in [SECURITY.md](SECURITY.md).
For bugs and feature requests, open a GitHub issue with the smallest reproducible
project manifest possible. Do not attach private art, metadata, or credentials.

## License

[MIT](LICENSE). The engine is a clean-room implementation inspired by common
generative-art concepts such as ordered layers, weighted selection, and DNA
uniqueness. It does not include third-party collection art or code.
