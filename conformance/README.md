# Conformance fixtures

This directory will hold serialized examples used as normative implementation evidence.

```text
fixtures/
  valid/     accepted deterministic RSL documents
  invalid/   rejected documents paired with expected diagnostic codes
expected/    deterministic generated artifacts such as Mermaid snapshots
```

Fixtures and expected projections are introduced with the milestone that defines their semantics. `test/release-conformance.test.ts` composes the canonical ASL-inspired fixture, runtime registries, deterministic Mermaid projection, trace protocol, and built package surface as the RSL v0.1 release gate.
