# Higher-order operation policies

RSL 13 compiles Observable-producing Workers through explicit RxJS flattening
operations. The Worker receives an outer value and returns an Observable-shaped
description of inner work. It does not select or contain the flattening operator.

The operation reference declares the policy:

| RSL operation     | RxJS operation | Policy             |
| ----------------- | -------------- | ------------------ |
| `rxjs.mergeMap`   | `mergeMap`     | allow overlap      |
| `rxjs.switchMap`  | `switchMap`    | retain only latest |
| `rxjs.concatMap`  | `concatMap`    | queue              |
| `rxjs.exhaustMap` | `exhaustMap`   | ignore while busy  |

`mergeMap` accepts an optional positive-integer `concurrency` parameter. Omitting
it leaves concurrency unbounded. The setting and every inner subscription are
created inside one workflow execution and are never shared across subscriptions.

## Type contract

An Observable-producing Worker declares:

```text
input: A
output: Observable<B>
```

The operation contract uses `worker-output-value` to compare `B` with the
Pipeline output port. The Observable container is an execution mechanism and is
not emitted through that port.

## Termination and cancellation

Outer completion waits according to the chosen RxJS policy. Inner errors fail the
Pipeline and tear down owned work. `switchMap` cancellation unsubscribes stale
inner work; it never converts teardown into an inner `complete` notification.

The conformance suite uses RxJS virtual time and one identical Source/Worker
scenario for all four policies. The resulting notification and teardown traces
are deterministic and distinct. Formal execution identifiers and the public RSL
trace protocol remain RSL 15.
