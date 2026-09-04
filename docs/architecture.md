# Architecture boundaries

## Transformation pipeline

```text
Deterministic YAML
  -> parsed document
  -> normalized typed DAG
  -> validated graph
  -> resolved graph
  -> RxJS Observable workflow definition
  -> subscription
  -> workflow execution
```

Each arrow is an explicit boundary with its own inputs, outputs, diagnostics, and tests.

## Description versus execution

Parsing, normalization, validation, reference resolution, compilation, visualization, and static checking must not subscribe to an Observable or invoke a Source, Worker, or Sink.

Subscription creates execution-local state and activates the required Source paths. Unsubscription tears down the work owned by that execution.

## Registry separation

The implementation will use independent registries for:

- Sources;
- operations;
- Workers;
- Sinks;
- schedulers;
- type contracts.

An identifier in one category cannot silently resolve in another category.

## Operator and Worker separation

An operation definition owns RxJS orchestration. A Worker owns domain computation.

For a higher-order Pipeline, the compiler constructs the selected operation around an Observable-producing Worker. The Worker must not hide whether overlap is allowed, only the latest work is retained, work is queued, or new work is ignored while busy.

## Planned module flow

```text
rsl-yaml
  -> rsl-model
  -> rsl-validator
  -> rsl-registry
  -> rsl-compiler
  -> rsl-runtime

rsl-test and rsl-viz consume public models and traces.
rsl-cli composes the public APIs.
```

Package directories will be introduced only when the module boundaries become concrete. RSL 05 uses one package to avoid pretending that undeveloped modules already have stable APIs.
