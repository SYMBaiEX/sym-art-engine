import type { LoadedProject } from '../config/loadProject.js';
import type { Trait } from '../schemas/trait.js';

export interface NftAttribute {
  trait_type: string;
  value: string;
}

export interface NftMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: NftAttribute[];
}

function fillTemplate(
  template: string,
  edition: number,
  padding: number,
): string {
  return template
    .replaceAll('{edition}', String(edition))
    .replaceAll('{editionPadded}', String(edition).padStart(padding, '0'));
}

/**
 * ERC-721-compatible metadata. One attribute per public category — the
 * compositor's multi-asset internals never leak. None traits are emitted
 * or hidden per category configuration.
 */
export function buildMetadata(
  edition: number,
  selected: ReadonlyMap<string, Trait>,
  project: LoadedProject,
): NftMetadata {
  const meta = project.config.metadata;
  const attributes: NftAttribute[] = [];
  for (const category of project.categoryOrder) {
    const trait = selected.get(category.id);
    if (!trait) continue;
    if (trait.none && !category.emitNoneInMetadata) continue;
    attributes.push({ trait_type: category.name, value: trait.name });
  }
  const metadata: NftMetadata = {
    name: fillTemplate(meta.nameTemplate, edition, meta.editionPadding),
    description: fillTemplate(meta.descriptionTemplate, edition, meta.editionPadding),
    image: fillTemplate(meta.imageTemplate, edition, meta.editionPadding),
    attributes,
  };
  if (meta.externalUrl) metadata.external_url = meta.externalUrl;
  return metadata;
}
