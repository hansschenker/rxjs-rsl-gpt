# Execution lifecycle and tracing

RSL 15 exposes what happens during a workflow execution without changing the values moving through it.

## Lifecycle

Compilation remains lazy. Each subscription creates one execution identity, one event sequence, and execution-local node participation identities. An execution ends with exactly one outcome:

- `complete` after the workflow completes;
- `error` after an unrecovered error;
- `cancelled` when its Subscription is unsubscribed before a terminal notification.

Finalization records teardown after any of these outcomes. Cancellation is never reported as completion.

## Trace events

| Event                 | Meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `execution.started`   | A subscription created a running workflow execution.          |
| `node.subscribed`     | That execution subscribed to one node dataflow.               |
| `scheduler.bound`     | A scheduler role participates at that node.                   |
| `node.notification`   | The node moved `next`, `error`, or `complete` downstream.     |
| `node.finalized`      | One node participation completed, errored, or was cancelled.  |
| `execution.finalized` | The complete workflow execution reached its recorded outcome. |

Every event contains `expressionId`, `executionId`, `sequence`, and `time`. Node events also contain `nodeId`; subscription-specific events contain `subscriptionId`. Equal-time events remain ordered by the execution-local sequence.

The optional `now` function supplies time. Tests can inject `scheduler.now` for logical virtual time; production integrations can retain the physical-time default.

## Cold and shared participation

The trace records actual subscriptions, not merely static graph edges. A cold node reached by two downstream consumers therefore shows two participation identities. When an explicit sharing node keeps one upstream execution alive, its upstream nodes show one participation. The values themselves remain unchanged.

## Observational safety

Tracing is optional and configured when compiling:

```ts
const workflow = compileRslGraph(semanticEvidence, {
  trace: writeTrace,
  executionId: () => createExecutionId(),
  now: () => scheduler.now(),
});
```

A trace observer cannot send values into the workflow. If it throws, RSL isolates that failure so it cannot replace, complete, cancel, or error the dataflow.
