# Registries and reference resolution

RSL 09 connects stable symbolic references in a workflow definition to runtime-owned capabilities without invoking those capabilities.

## Category boundaries

The environment contains six separate immutable registries:

| Registry  | Referenced by                                  |
| --------- | ---------------------------------------------- |
| Source    | `SourceNode.operation`                         |
| Operation | `PipelineNode.operation`                       |
| Sink      | `SinkNode.operation`                           |
| Worker    | node Worker bindings                           |
| Scheduler | node scheduler bindings                        |
| Type      | named and generic TypeRefs at every occurrence |

A matching name in another registry is not accepted. It produces `REG-006_WRONG_CATEGORY`, preserving the distinction between stream orchestration, domain computation, scheduling, and type contracts.

## Functional API

- `createRslRegistry(category, definitions)` creates a frozen registry and rejects invalid or duplicate `(ref, version)` definitions.
- `createRslRegistries(partial)` creates the six-category environment, supplying empty registries where omitted.
- `validateRslReferences(expression, registries)` returns all deterministic resolution diagnostics.
- `resolveRslReferences(expression, registries)` returns a `ResolvedRslExpression` or throws `RslRegistryError`.

The resolved expression keeps the original normalized graph and adds resolved node and TypeRef bindings. Registry values remain opaque `unknown` capabilities at this milestone. RSL 10 validates contracts; RSL 11 introduces the concrete compiler-facing runtime interfaces.

## Version rules

A versioned reference requires an exact `(ref, version)` definition. An unversioned reference resolves when exactly one definition has that name. If several versions share the name, the reference is ambiguous and must state a version explicitly.

## Diagnostic codes

| Code    | Meaning                                      |
| ------- | -------------------------------------------- |
| REG-001 | Invalid reference or definition identity     |
| REG-002 | Duplicate category/name/version definition   |
| REG-003 | No definition with that reference exists     |
| REG-004 | Unversioned reference has several candidates |
| REG-005 | Requested version is unavailable             |
| REG-006 | Name exists only in another category         |

Registration and resolution perform no subscription, Source activation, Worker invocation, scheduler action, type predicate call, or operation compilation. They select values; they do not run them.
