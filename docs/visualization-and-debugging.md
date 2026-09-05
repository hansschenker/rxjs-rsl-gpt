# Visualization and debugging

RSL 17 provides two read-only views of the RxJS machine: a static graph projection and a runtime execution snapshot.

## Mermaid graph

`renderRslMermaid(expression)` renders every declared Source, Pipeline, Sink, and edge exactly once. Nodes expose their operation, named Worker, concurrency or error policy, and scheduler roles. Edges expose port direction and the type that flows over time.

```ts
const diagram = renderRslMermaid(expression);
```

The renderer sorts node and edge presentation, so equivalent declaration order produces identical text. It generates safe internal Mermaid aliases and escapes user-controlled labels. Rendering performs no registry invocation, Source activation, Worker call, subscription, or scheduling.

Options can select left-to-right or top-down layout and hide type, Worker, scheduler, or policy detail. These choices alter presentation only; they cannot add, remove, or reconnect an edge.

## Debug snapshot

`createRslDebugSnapshot(events)` folds the trace of exactly one execution into a stable snapshot:

- current execution status;
- trace sequence bounds and event count;
- actual subscription and active-participation counts per node;
- number and last kind of notifications;
- last moved value or error;
- complete, error, and cancellation outcomes;
- bound scheduler roles;
- retry and recovery counts.

Snapshots preserve cold-versus-shared behavior because they summarize actual node subscriptions, not merely the static graph. The fold accepts only one `expressionId` and `executionId`, and trace events must be in increasing sequence order.

Visualization and debugging are observers of RSL. Neither API can emit a value, recover an error, cancel an execution, or alter sharing.

## Execution timeline

`renderRslTimelineMermaid(expression, events, nodeId?)` combines the static graph with one saved execution trace. It renders every `next`, `error`, or `complete` notification observed at the selected node in sequence order, including logical time and JSON-safe values. When `nodeId` is omitted, the first Sink is selected.

An optional `x-jsonata` extension can document the expression associated with a Source, Pipeline, or Sink:

```yaml
x-jsonata: "{% $ * 2 %}"
```

In RSL 0.1 this annotation is visualization metadata. It is displayed but not evaluated; the named Worker remains the executable implementation.

Generate a timeline from the CLI with:

```bash
rsl visualize workflow.rsl.yaml --trace trace.json --node Console
```
