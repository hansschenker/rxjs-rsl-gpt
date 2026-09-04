# Normalized TypeScript model

RSL 06 defines the immutable in-memory representation used after parsing and before validation, reference resolution, or compilation.

## Expression and topology

`RslExpression` is the root value. It fixes the language version to `0.1` and contains ordered node and edge collections. Nodes form a closed discriminated union:

| Node     | Inputs   | Outputs  |
| -------- | -------- | -------- |
| Source   | none     | nonempty |
| Pipeline | nonempty | nonempty |
| Sink     | nonempty | none     |

Every port has an explicit direction, local identifier, and `PortTypeRef`. Every edge connects an output address to an input address. Graph-wide rules—such as requiring at least one Source and Sink, endpoint existence, connectivity, and acyclicity—remain validator responsibilities in RSL 08.

## Types and references

`TypeRef` normalizes primitive, named, array, tuple, record, union, generic, and Observable result types into discriminated objects. `void` and top-level Observable types cannot be carried by ports; they describe Worker return contracts. Recursive semantic checks arrive in RSL 10.

Operations, Workers, schedulers, and type contracts have category-specific reference types. A Worker binding may carry its declared category, input/output types, and purity without embedding executable code.

## Declarative values

Parameters and `x-` extensions use the recursive `RslValue` union: null, booleans, finite-number candidates, strings, arrays, and mappings. This keeps the normalized model serializable and prevents runtime functions or class instances from entering it. Numeric and extension-key validation remains a later phase.

All model properties and collections are `readonly`. Optional source locations preserve parser diagnostics without affecting semantic identity.
