# Structural validator

RSL 08 validates whether a normalized RSL expression is a finite, connected directed acyclic dataflow graph from one or more Sources to one or more Sinks.

## Public API

- `validateRslStructure(expression)` returns a discriminated result and never throws for graph defects.
- A valid result contains `topologicalOrder`, with declaration order used as the deterministic tie-breaker.
- An invalid result contains ordered structural diagnostics.
- `assertValidRslStructure(expression)` returns the valid result or throws `RslStructuralError` containing every diagnostic.

## Validation order

The implementation follows the canonical dependency order:

1. local and unique expression, node, and port identities;
2. Source and Sink cardinality;
3. Source, Pipeline, and Sink port polarity;
4. output-to-input edge direction and declared endpoints;
5. exactly one edge per input and one or more edges per output;
6. cycle detection and stable topological ordering;
7. reachability from a Source and ability to reach a Sink.

This milestone intentionally does not compare `TypeRef`s. Edge type compatibility and operation-contract compatibility belong to RSL 10, after references can be resolved by RSL 09.

## Diagnostic families

Structural codes are stable identifiers from `STR-001_INVALID_LOCAL_ID` through `STR-016_CANNOT_REACH_SINK`. Each diagnostic contains a model path and, where applicable, the node, port, or edge identity involved.

The validator is a pure inspection of the workflow definition. It does not resolve operations, invoke Workers, construct an RxJS pipeline, activate a Source, schedule work, or subscribe. Fan-out remains topology only and does not imply sharing.
