# Scheduler and time runtime

RSL 14 makes scheduler references executable while keeping runtime objects outside YAML.

## Three scheduler roles

```yaml
Scheduler:
  Operation: schedulers.virtual
  SubscribeOn: schedulers.subscription
  ObserveOn: schedulers.notifications
```

| Role          | Runtime meaning                                                                     |
| ------------- | ----------------------------------------------------------------------------------- |
| `Operation`   | Passed to a time-aware Source or operation such as `interval`, `timer`, or `delay`. |
| `SubscribeOn` | Controls when subscription to the node's upstream dataflow begins.                  |
| `ObserveOn`   | Controls when the node delivers `next`, `error`, and `complete` downstream.         |

A scalar is shorthand for the operation scheduler:

```yaml
Scheduler: schedulers.virtual
```

Scheduler references resolve through the scheduler registry. The resolved value must satisfy RxJS `SchedulerLike`; resolution itself never schedules work.

## Execution boundary

Compilation validates scheduler capabilities but creates no scheduled action. Each workflow subscription creates and owns its scheduled actions. Unsubscription cancels those actions through normal RxJS teardown and emits no completion notification.

## Logical time and ordering

RSL uses the selected scheduler's clock as execution time. A virtual scheduler therefore provides deterministic logical time without changing the workflow definition.

Actions scheduled for the same logical time execute in scheduler sequence order. This preserves notification order, including the required ordering of final `next` before `complete` at the same time.

## Time-aware capabilities

RSL 14 provides reference capabilities for:

- `rxjs.interval` with `Arguments.Period`;
- `rxjs.timer` with `Arguments.DueTime`;
- `rxjs.delay` with `Arguments.Duration`.

They use the node's operation scheduler when declared and RxJS `asyncScheduler` otherwise.

## Example

```yaml
Ticks:
  Type: Source
  Operation: rxjs.interval
  Arguments:
    Period: 1000
  Scheduler: schedulers.animationFrame
  Output:
    Type: number
  Next: Render
```

Time comes from the Source and resolved scheduler. The Pipeline continues to move ordinary typed notifications.
