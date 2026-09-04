# Unary RxJS compiler

RSL 11 compiles a successfully resolved and semantically validated unary graph
into a cold RxJS 7 `Observable<never>` workflow definition. The definition emits
no data after its terminal Sink, but preserves completion and error.

`compileRslUnary` accepts `ValidSemanticResult`, making successful RSL 10
validation explicit. It supports exactly one connected Source-to-Sink path.
Multiple Sources, fan-out, multi-input operations, and sharing are RSL 12.

The entire chain is enclosed in `defer`. Compilation calls no Source, operation,
Worker, or Sink capability. Each subscription activates the Source and constructs
fresh operator state. Unsubscription tears down the composed RxJS subscription;
it does not emit `complete`.

Registry runtime values have four distinct roles:

- `RslSourceCapability` produces an `ObservableInput` per subscription;
- `RslUnaryOperationCapability` constructs an RxJS `OperatorFunction`;
- `RslRuntimeWorker` performs named domain computation;
- `RslSinkCapability` consumes the final stream and returns a terminal stream.

The bundled adapters cover `from`, `of`, `defer`, `map`, `filter`, `scan`, `tap`,
`take`, `skip`, `takeWhile`, an effect Sink, and an Observer Sink. They are
ordinary registry values, not special syntax in the compiler. A `takeUntil`
notifier is a second input stream and therefore belongs to RSL 12 rather than
being hidden inside a Worker.
