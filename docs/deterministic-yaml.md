# Deterministic YAML implementation

RSL 07 implements the concrete boundary between developer-authored YAML and the immutable RSL 06 graph.

## Dataflow

```text
UTF-8 YAML text
  -> restricted YAML value parser
JSON-compatible RslValue
  -> RSL schema normalization
RslExpression
  -> canonical serializer
stable RSL YAML text
```

None of these stages resolves or invokes an operation, Worker, Source, Sink, or scheduler. Parsing creates no Observable and no subscription.

## Public API

- `parseRslYamlValue(source)` accepts the restricted value language.
- `normalizeRslDocument(value)` validates concrete RSL fields and normalizes shorthand.
- `parseRslExpression(source)` composes those two stages.
- `stringifyRslYamlValue(value)` emits deterministic YAML values.
- `stringifyRslExpression(expression)` emits canonical RSL documents.
- `RslYamlError` exposes a stable error category through `code`.

## Accepted input

Authored input may contain comments, blank lines, safe plain strings, double-quoted JSON strings, block collections, and flow-style sequences without trailing commas. Primitive and named TypeRefs may use scalar shorthand.

The parser rejects document markers and directives, duplicate or non-string keys, empty null shorthand, tabs outside strings, legacy booleans, implicit dates, invalid and unsafe numbers, single-quoted or block strings, flow mappings, anchors, aliases, merge keys, and explicit tags. Strings and keys normalize to Unicode NFC.

## Canonical output

The writer uses two-space indentation, block collections, deterministic schema-field ordering, lexical ordering for remaining keys, normalized scalar spellings, JSON string escapes, LF line endings, and one final newline. Comments are intentionally absent. Parsing canonical output and writing it again is idempotent.

RSL 07 validates concrete document shape and TypeRef syntax only. Graph-wide topology belongs to RSL 08; reference resolution belongs to RSL 09; compatibility between connected types and operation contracts belongs to RSL 10.
