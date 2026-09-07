/** Public library surface for collection tooling and integrations. */
export { loadProject, ProjectLoadError, type LoadedProject } from './config/loadProject.js';
export { ENGINE_VERSION, GenerationError, generateCollection } from './engine/generator.js';
export { validateProject, formatIssue, type Issue, type ValidationReport } from './engine/validator.js';
export { selectEdition, resolveFixedEdition, type SelectionResult } from './engine/selector.js';
export { buildMetadata, type NftAttribute, type NftMetadata } from './engine/metadata.js';
export { buildRenderPlan, type PlacedAsset } from './engine/renderPlan.js';
export { canonicalDnaSource, dnaHash } from './engine/dna.js';
export { compositePlan } from './engine/compositor.js';
export { createRng } from './utils/prng.js';
export { AssetRefSchema, TraitSchema, type AssetRef, type Trait } from './schemas/trait.js';
export { ProjectConfigSchema, type Category, type ProjectConfig } from './schemas/project.js';
export { RulesFileSchema, type RulesFile } from './schemas/rules.js';
