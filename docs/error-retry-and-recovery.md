# Error, retry, and recovery

RSL 16 keeps the ordinary RxJS rule: an error terminates a dataflow unless an explicit Pipeline operation intercepts it.

## Retry policy

`rxjs.retry` resubscribes to its upstream dataflow. It does not repeat only the failing Worker call. Therefore every cold Source and operation inside that upstream scope runs again.

```yaml
RetryRequest:
  Type: Pipeline
  Operation: rxjs.retry
  Arguments:
    Count: 2
    Delay: 100
    BackoffRate: 2
    ResetOnSuccess: false
  Scheduler: schedulers.retryClock
  Input:
    Type: ApiResponse
  Output:
    Type: ApiResponse
  Next: RecoverRequest
```

`Count` is the maximum number of retries after the first attempt. `Delay` is the first retry delay. Retry number `n` waits `Delay × BackoffRate^(n-1)`. The operation scheduler supplies time; without one, RxJS asynchronous time is used. `ResetOnSuccess` defaults to false.

All policy values are execution-local. A successful attempt continues normally. When the count is exhausted, the last error moves downstream.

## Recovery policy

`rxjs.catchError` invokes one named Observable-producing Worker with the error:

```yaml
RecoverRequest:
  Type: Pipeline
  Operation: rxjs.catchError
  Worker: workers.recoverRequest
  Input:
    Type: ApiResponse
  Output:
    Type: ApiResponse
  Next: Render
```

The Worker returns `Observable<ApiResponse>`. That replacement dataflow may emit zero or more values and then complete or error. An error from the replacement remains terminal unless another explicit recovery Pipeline follows it.

The Worker's input type must match the Pipeline error channel. Its returned Observable value type must match the Pipeline output next type.

## Cancellation and tracing

Unsubscription during a retry delay cancels the scheduled retry. It invokes no further Source, Worker, or recovery operation and emits no terminal notification.

`error.retry` records the retry number, calculated delay, error, node, execution, time, and sequence. `error.recovery` records when an exhausted or otherwise intercepted error enters the named recovery Worker.
