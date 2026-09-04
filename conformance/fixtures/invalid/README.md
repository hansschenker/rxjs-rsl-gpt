# Invalid fixtures

RSL 07 YAML syntax cases are table-driven in `test/yaml.test.ts`. RSL 08 graph defects are assembled from the canonical valid fixture in `test/structural-validator.test.ts`, where every defect asserts its stable `STR-*` diagnostic code and model path.

RSL 09 registry and resolution failures are assembled in `test/registry.test.ts`. The suite covers invalid and duplicate definitions plus missing, ambiguous, version-mismatched, and wrong-category references using stable `REG-*` diagnostics.
