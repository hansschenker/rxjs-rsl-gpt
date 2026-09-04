# RxJS RSL

Reference implementation of **Reactive Specification Language (RSL) v0.1** for RxJS 7.8.2.

RSL describes a lazy, typed, directed acyclic dataflow graph containing one or more Source nodes, zero or more Pipeline nodes, and one or more Sink nodes. Compilation creates an Observable workflow definition. Nothing executes until subscription.

## Status

**RSL 08 — Structural Validator**

The repository now validates normalized graphs for identities, Source and Sink cardinality, node polarity, edge endpoints, complete connections, output usefulness, cycles, and Source-to-Sink reachability. A valid graph receives a stable topological order. Type and operation-contract validation remains in RSL 10.

## Commands

```bash
npm install
npm run check
```

`npm run check` verifies formatting, lint rules, strict TypeScript compilation, and tests.

## Semantic boundaries

- RxJS 7.8.2 is pinned for RSL v0.1.
- An RSL expression is a typed DAG with explicit nodes, ports, and edges.
- Compilation is lazy; subscription starts one workflow execution.
- Sources, operations, Workers, Sinks, schedulers, and types use separate registries.
- Operators orchestrate; named Workers perform domain computation.
- Multiple Sources and Sinks are first-class.
- Time, cancellation, and sharing are explicit.
- Cancellation is teardown, not completion.
- Only the deterministic RSL YAML subset will be accepted.

See [Structural validator](docs/structural-validator.md), [Deterministic YAML](docs/deterministic-yaml.md), [Normalized model](docs/normalized-model.md), [Canonical specifications](docs/canonical-specifications.md), [Architecture boundaries](docs/architecture.md), and the [Conformance matrix](docs/conformance-matrix.md).

## Planned milestone sequence

| Milestone | Deliverable                                  |
| --------- | -------------------------------------------- |
| RSL 05    | Repository and conformance scaffold          |
| RSL 06    | Normalized TypeScript model                  |
| RSL 07    | Deterministic YAML parser and serializer     |
| RSL 08    | Structural validator                         |
| RSL 09    | Registries and reference resolution          |
| RSL 10    | Type and operation-contract validator        |
| RSL 11    | Unary RxJS compiler and first vertical slice |
| RSL 12    | Multi-input, branching, and sharing          |
| RSL 13    | Higher-order operation policies              |
| RSL 14    | Scheduler and time runtime                   |
| RSL 15    | Execution lifecycle and tracing              |
| RSL 16    | Error, retry, and recovery semantics         |
| RSL 17    | Visualization and debugging                  |
| RSL 18    | CLI and developer workflow                   |
| RSL 19    | End-to-end conformance and v0.1 release      |
