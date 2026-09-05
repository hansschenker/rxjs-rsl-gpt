# RSL v0.1 release conformance

RSL 19 closes the v0.1 implementation with one public document-to-workflow boundary and one end-to-end release gate.

## Document compiler

`compileRsl(source, registries, options)` composes the normative stages in order:

1. parse the deterministic RSL YAML subset;
2. validate graph structure and topology;
3. resolve typed registry references without invoking them;
4. validate operation, Worker, handler, port, and type contracts;
5. compile a lazy RxJS workflow definition.

Compilation still performs no Source activation, Worker call, scheduling, or subscription. Each subscription owns its runtime state, trace identity, scheduled work, error policy, inner subscriptions, and teardown.

Stage-specific errors remain observable through their existing `RslYamlError`, `RslStructuralError`, `RslRegistryError`, `RslSemanticError`, and `RslCompilerError` types.

## Release gate

The release conformance test starts from the canonical multi-source fixture and crosses every public boundary. It proves:

- compilation is lazy before subscription;
- canonical serialization round-trips;
- Mermaid equals the checked-in deterministic projection;
- multiple Sources feed `combineLatest` in declared port order;
- `switchMap` owns its dynamic inner Observable and latest-only policy;
- Sink next, error, and complete handlers resolve through the Worker registry;
- one subscription produces the expected value and a complete execution trace;
- malformed YAML and unresolved references retain stage-specific failures;
- the built self-referenced package exports the v0.1 API.

The package version is `0.1.0`. Its ESM entry, declaration entry, export map, CLI binary, and packed `dist` boundary all point at the distributable build.

## Conformance claim

The implementation is **RSL v0.1 conformant** when `npm run check` passes from a clean checkout. The claim covers the normative language and runtime behavior listed in the conformance matrix. It does not imply compatibility with a future RSL version or with arbitrary YAML outside the deterministic subset.
