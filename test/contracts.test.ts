import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  areTypeRefsEqual,
  assertValidRslSemantics,
  createRslRegistries,
  createRslRegistry,
  generateTypeScriptEdgeAssertions,
  isTypeRefAssignable,
  parseRslExpression,
  resolveRslReferences,
  RslSemanticError,
  validateRslSemantics,
  type NodeOperationContract,
  type RslExpression,
  type TypeRef,
  type WorkerContract,
} from "../src/index.js";

const number = { kind: "primitive", name: "number" } as const;
const string = { kind: "primitive", name: "string" } as const;
const runtimeCapability = (): void => undefined;
const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});
const unaryWorker = (
  category: "transformation" | "effect",
): NodeOperationContract => ({
  inputArity: { min: 1, max: 1 },
  outputArity: {
    min: category === "effect" ? 0 : 1,
    max: category === "effect" ? 0 : 1,
  },
  worker: {
    required: true,
    categories: [category],
    purity: category === "effect" ? "effectful" : "pure",
    inputArity: { min: 1, max: 1 },
  },
  constraints: [
    {
      source: { kind: "node-input", index: 0 },
      target: { kind: "worker-input", index: 0 },
      relation: "assignable",
    },
    ...(category === "effect"
      ? []
      : [
          {
            source: { kind: "worker-output" } as const,
            target: { kind: "node-output", index: 0 } as const,
            relation: "assignable" as const,
          },
        ]),
  ],
});

async function fixture(): Promise<RslExpression> {
  return parseRslExpression(
    await readFile(
      new URL(
        "../conformance/fixtures/valid/double-and-filter.rsl.yaml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

function registries(
  overrides: { map?: NodeOperationContract; double?: WorkerContract } = {},
) {
  return createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "rxjs.from",
        value: runtimeCapability,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.map",
        value: runtimeCapability,
        contract: overrides.map ?? unaryWorker("transformation"),
      },
    ]),
    sinks: createRslRegistry("sink", [
      {
        category: "sink",
        ref: "rxjs.subscribe",
        value: runtimeCapability,
        contract: unaryWorker("effect"),
      },
    ]),
    workers: createRslRegistry("worker", [
      {
        category: "worker",
        ref: "workers.double",
        value: runtimeCapability,
        contract: overrides.double ?? {
          category: "transformation",
          inputs: [number],
          output: number,
          purity: "pure",
        },
      },
      {
        category: "worker",
        ref: "workers.render",
        value: runtimeCapability,
        contract: {
          category: "effect",
          inputs: [number],
          output: { kind: "primitive", name: "void" },
          purity: "effectful",
        },
      },
    ]),
  });
}

function withNode(
  expression: RslExpression,
  index: number,
  change: Partial<RslExpression["nodes"][number]>,
): RslExpression {
  return {
    ...expression,
    nodes: expression.nodes.map((node, current) =>
      current === index ? { ...node, ...change } : node,
    ) as unknown as RslExpression["nodes"],
  };
}

void test("validates the ordinary source, operation, and sink path without execution", async () => {
  let invocations = 0;
  const capability = (): void => {
    invocations += 1;
  };
  const base = registries();
  const custom = createRslRegistries({
    ...base,
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.map",
        value: capability,
        contract: unaryWorker("transformation"),
      },
    ]),
  });
  const result = validateRslSemantics(
    resolveRslReferences(await fixture(), custom),
    custom,
  );
  assert.equal(result.valid, true);
  assert.equal(invocations, 0);
});

void test("supports recursive exact and explicit assignable compatibility", () => {
  const narrow: TypeRef = {
    kind: "record",
    fields: { id: number, tags: { kind: "array", items: string } },
  };
  const wide: TypeRef = { kind: "record", fields: { id: number } };
  assert.equal(
    areTypeRefsEqual(narrow, {
      kind: "record",
      fields: { tags: { kind: "array", items: string }, id: number },
    }),
    true,
  );
  assert.equal(areTypeRefsEqual(narrow, wide), false);
  assert.equal(
    isTypeRefAssignable(narrow, wide, { profile: "assignable" }),
    true,
  );
  assert.equal(isTypeRefAssignable(narrow, wide, { profile: "exact" }), false);
  assert.equal(
    isTypeRefAssignable(
      number,
      { kind: "union", members: [string, number] },
      { profile: "assignable" },
    ),
    true,
  );
});

void test("uses transitive named-type relations only in the assignable profile", () => {
  const types = createRslRegistry("type", [
    {
      category: "type",
      ref: "types.Dog",
      value: 0,
      contract: { assignableTo: ["types.Mammal"] },
    },
    {
      category: "type",
      ref: "types.Mammal",
      value: 0,
      contract: { assignableTo: ["types.Animal"] },
    },
    { category: "type", ref: "types.Animal", value: 0 },
  ]);
  assert.equal(
    isTypeRefAssignable(
      { kind: "named", ref: "types.Dog" },
      { kind: "named", ref: "types.Animal" },
      { profile: "assignable", types },
    ),
    true,
  );
});

void test("reports edge, operation, and Worker contract violations", async () => {
  const expression = await fixture();
  const incompatible = withNode(expression, 1, {
    inputs: [{ direction: "input", id: "value", type: string }],
  });
  const edge = validateRslSemantics(
    resolveRslReferences(incompatible, registries()),
    registries(),
  );
  assert.ok(
    edge.diagnostics.some((item) => item.code === "TYP-001_INCOMPATIBLE_EDGE"),
  );

  const bad = registries({
    map: {
      ...unaryWorker("transformation"),
      inputArity: { min: 2, max: 2 },
      worker: {
        required: true,
        categories: ["predicate"],
        purity: "effectful",
        inputArity: { min: 2, max: 2 },
      },
    },
  });
  const result = validateRslSemantics(
    resolveRslReferences(expression, bad),
    bad,
  );
  assert.deepEqual(
    new Set(result.diagnostics.map((item) => item.code)),
    new Set([
      "TYP-003_OPERATION_ARITY",
      "TYP-007_WORKER_CATEGORY",
      "TYP-008_WORKER_PURITY",
      "TYP-009_WORKER_ARITY",
    ]),
  );
});

void test("checks declared Worker types and declarative constraints", async () => {
  const base = await fixture();
  const declared = withNode(base, 1, {
    worker: {
      worker: { kind: "worker", ref: "workers.double" },
      input: number,
      output: number,
    },
  });
  const r = registries({
    double: {
      category: "transformation",
      inputs: [string],
      output: number,
      purity: "pure",
    },
  });
  const declaredResult = validateRslSemantics(
    resolveRslReferences(declared, r),
    r,
  );
  assert.ok(
    declaredResult.diagnostics.some(
      (item) => item.code === "TYP-011_DECLARED_WORKER_TYPE",
    ),
  );
  assert.ok(
    declaredResult.diagnostics.some(
      (item) => item.code === "TYP-010_CONTRACT_CONSTRAINT",
    ),
  );
});

void test("accepts Observable-producing Worker return contracts", async () => {
  const observable: TypeRef = { kind: "observable", value: number };
  const expression = withNode(await fixture(), 1, {
    worker: {
      worker: { kind: "worker", ref: "workers.double" },
      input: number,
      output: observable,
    },
  });
  const r = registries({
    double: {
      category: "transformation",
      inputs: [number],
      output: observable,
      purity: "pure",
    },
    map: {
      ...unaryWorker("transformation"),
      constraints: [
        {
          source: { kind: "node-input", index: 0 },
          target: { kind: "worker-input", index: 0 },
          relation: "equal",
        },
      ],
    },
  });
  assert.equal(
    validateRslSemantics(resolveRslReferences(expression, r), r).valid,
    true,
  );
});

void test("checks reducer seed presence and state type", async () => {
  const base = await fixture();
  const reducerContract: NodeOperationContract = {
    ...unaryWorker("transformation"),
    reducer: { seedParameter: "seed", stateInput: 0, valueInput: 1 },
  };
  const r = registries({
    map: reducerContract,
    double: {
      category: "transformation",
      inputs: [number, number],
      output: number,
      purity: "pure",
    },
  });
  const missing = validateRslSemantics(resolveRslReferences(base, r), r);
  assert.ok(
    missing.diagnostics.some(
      (item) => item.code === "TYP-012_MISSING_REDUCER_SEED",
    ),
  );
  const seeded = withNode(base, 1, { parameters: { seed: "wrong" } });
  const wrong = validateRslSemantics(resolveRslReferences(seeded, r), r);
  assert.ok(
    wrong.diagnostics.some((item) => item.code === "TYP-013_REDUCER_SEED_TYPE"),
  );
});

void test("generates TypeScript edge assertions and throws stable semantic errors", async () => {
  const expression = await fixture();
  const output = generateTypeScriptEdgeAssertions(expression);
  assert.match(output, /type RslEdge0 = RslAssert<RslEqual<number, number>>/u);
  const missingContract = createRslRegistries({
    ...registries(),
    operations: createRslRegistry("operation", [
      { category: "operation", ref: "rxjs.map", value: runtimeCapability },
    ]),
  });
  assert.throws(
    () =>
      assertValidRslSemantics(
        resolveRslReferences(expression, missingContract),
        missingContract,
      ),
    (error: unknown) =>
      error instanceof RslSemanticError &&
      error.diagnostics.some(
        (item) => item.code === "TYP-002_MISSING_OPERATION_CONTRACT",
      ),
  );
});
