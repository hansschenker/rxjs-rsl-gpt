# RxJS RSL

Reference implementation of **Reactive Specification Language (RSL) v0.1** for RxJS 7.8.2.

RSL describes a lazy, typed, directed acyclic dataflow graph containing one or more Source nodes, zero or more Pipeline nodes, and one or more Sink nodes. Compilation creates an Observable workflow definition. Nothing executes until subscription.

## Status

**RSL 15 — Execution lifecycle and tracing**

Each subscription now creates an independently identified execution trace. Lifecycle, node participation, notifications, scheduler bindings, sharing behavior, cancellation, terminal outcome, and teardown are correlated by stable identities and sequence numbers.

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
- `Input` is the unary form; ordered `Inputs` bind multi-source operations.
- Compact `Type` ports expand to `Next.Type`, `Error.Type: unknown`, and `Complete: true`.
- Sink `Handlers` resolve named `Next`, `Error`, and `Complete` Workers.
- `InnerSource` is an execution-local template, not a fourth static node type.

See the [RSL Specification v0.1](docs/RSL-Specification-v0.1.md), [Execution lifecycle and tracing](docs/execution-lifecycle-and-tracing.md), [Scheduler and time runtime](docs/scheduler-and-time-runtime.md), [Higher-order policies](docs/higher-order-policies.md), [Multi-input, branching, and sharing](docs/multi-input-branching-sharing.md), [Unary compiler](docs/unary-compiler.md), [Type and operation contracts](docs/type-and-operation-contracts.md), [Registries and resolution](docs/registries-and-resolution.md), [Structural validator](docs/structural-validator.md), [Deterministic YAML](docs/deterministic-yaml.md), [Normalized model](docs/normalized-model.md), [Canonical specifications](docs/canonical-specifications.md), [Architecture boundaries](docs/architecture.md), and the [Conformance matrix](docs/conformance-matrix.md).

## RSL example

```yaml
Version: "0.1"
StartAt: Numbers
Nodes:
  Numbers:
    Type: Source
    Operation: rxjs.from
    Arguments:
      - [1, 2, 3]
    Output:
      Type: number
    Next: Double
  Double:
    Type: Pipeline
    Operation: rxjs.map
    Worker: workers.double
    Input:
      Type: number
    Output:
      Type: number
    Next: Render
  Render:
    Type: Sink
    Input:
      Type: number
    Handlers:
      Next: workers.render
      Error: workers.renderError
      Complete: workers.renderComplete
    End: true
```

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
