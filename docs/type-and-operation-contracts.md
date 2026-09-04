# Type and operation contracts

RSL 10 adds a static semantic pass after structural validation and reference
resolution. It validates the resolved graph without invoking any registered
runtime capability.

## Compatibility profiles

The default `exact` profile requires recursive TypeRef equality. Record field
order and union member order do not affect equality. The explicit `assignable`
profile additionally supports `never`, `unknown`, union membership, tuple-to-array
assignment, record width subtyping, and transitive named-type relations declared
with `assignableTo`. A validation run uses one profile throughout; the profiles
are never mixed implicitly.

## Declarative registry contracts

Source, operation, and Sink definitions declare input/output arity, Worker
requirements, and type constraints. Worker definitions declare category, input
types, output type, and purity. This keeps orchestration rules separate from
runtime code and makes validation deterministic.

Reducer contracts identify the seed parameter and the Worker state/value input
positions. The validator requires a seed and checks its inferred RSL value type
against the state input. Worker outputs may be `observable<T>`; dataflow ports
still carry notification value types rather than Observable objects.

## API

- `validateRslSemantics` returns stable `TYP-*` diagnostics.
- `assertValidRslSemantics` throws `RslSemanticError` on failure.
- `areTypeRefsEqual` and `isTypeRefAssignable` expose recursive compatibility.
- `generateTypeScriptEdgeAssertions` emits compile-time assertions for every
  graph edge. A caller supplies a `RslNamedTypes` map when named refs are used.

Structural validation and reference resolution remain separate prerequisite
passes. RSL 10 assumes their successful output and does not repair malformed
graphs or unresolved references.
