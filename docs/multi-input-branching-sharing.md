# Multi-input, branching, and sharing

RSL 12 adds `compileRslGraph`, the general DAG compiler for multiple Sources,
ordered multi-input Pipeline nodes, fan-out, and multiple Sinks.

## Input binding

Incoming edges bind streams to Pipeline inputs by the declared input-port order,
not by edge-array order. Multi-input registry capabilities receive that ordered
array and own their RxJS coordination policy.

The built-in capabilities preserve RxJS 7 semantics:

- `combineLatest` waits for every input, then emits whenever any input changes;
- `forkJoin` emits the last value from every input after all inputs complete;
- `merge` allows input notifications to overlap;
- `concat` subscribes to inputs in port order;
- `zip` pairs notifications by position;
- `withLatestFrom` treats the first port as the driving input;
- `takeUntil` treats the first port as values and the second as its notifier.

## Branches and sharing

Fan-out is topology, not sharing. Without a sharing operation, every Sink branch
subscribes independently and therefore reactivates cold upstream Sources.

`operationShare` uses RxJS `share` with explicit `resetOnError`,
`resetOnComplete`, and `resetOnRefCountZero` parameters. It shares only
overlapping participation and replays nothing. `operationShareReplayOne` retains
one value and accepts an explicit `refCount` parameter.

All memoized stream descriptions, Subjects created by sharing operators, and
ref-count lifecycles are created inside the workflow subscription boundary. They
cannot leak between independent workflow executions.

## Current port boundary

RSL 12 supports one output stream per Source or Pipeline and one input per Sink.
Multiple incoming Pipeline ports and any number of outgoing edges are supported.
Named multiple-output routing remains outside this milestone and fails with
`CMP-004_UNSUPPORTED_PORT_SHAPE` rather than silently duplicating values.
