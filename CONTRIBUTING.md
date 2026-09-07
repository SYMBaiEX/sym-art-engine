# Contributing

Thank you for improving SYM Art Engine.

1. Open an issue before large behavior or schema changes.
2. Keep pull requests focused and collection-agnostic. Do not add private art,
   collection metadata, credentials, or generated outputs.
3. Add or update synthetic-fixture tests for behavior changes.
4. Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, and
   `npm pack --dry-run` before opening a pull request.

Schema or output changes should state whether they alter deterministic output
for an existing project. Breaking behavior belongs in a semver-major release.
