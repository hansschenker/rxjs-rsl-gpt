# Canonical specifications

The consolidated [RSL Specification v0.1](RSL-Specification-v0.1.md) is the normative concrete-language specification. The milestone documents below remain its semantic foundations.

The implementation is governed by these canonical RSL v0.1 artifacts, in dependency order:

1. `RSL-Structural-Foundation-v0.1.md`
2. `RSL-Core-Execution-Semantics-v0.1.md`
3. `RSL-Operation-and-Worker-Semantics-v0.1.md`
4. `RSL-Scheduler-and-Time-Semantics-v0.1.md`
5. `RSL-Deterministic-YAML-v0.1.md`
6. `RSL-Reference-Implementation-Plan-v0.1.md`

The artifacts are maintained as the normative project definitions. This repository contains the reference implementation and conformance evidence.

## Authority rule

When implementation code and a canonical specification disagree, the specification wins. The mismatch must be recorded, then resolved by changing the implementation or deliberately versioning the specification. Runtime code must not silently create new language semantics.

## Scope rule

RSL v0.1 is not AWS ASL and is not a one-result-per-state interpreter. It is a specification language for RxJS dataflows and therefore preserves Observable notification cardinality, laziness, cancellation, explicit sharing, and multi-source coordination.
