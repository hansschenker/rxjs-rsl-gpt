import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createRslRegistries,
  createRslRegistry,
  parseRslExpression,
  resolveRslReferences,
  RslRegistryError,
  validateRslReferences,
  type RegistryDiagnosticCode,
  type RslExpression,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../conformance/fixtures/valid/double-and-filter.rsl.yaml",
  import.meta.url,
);

async function fixture(): Promise<RslExpression> {
  return parseRslExpression(await readFile(fixtureUrl, "utf8"));
}

const runtimeCapability = (): void => undefined;

function completeRegistries() {
  return createRslRegistries({
    sources: createRslRegistry("source", [
      { category: "source", ref: "rxjs.from", value: runtimeCapability },
    ]),
    operations: createRslRegistry("operation", [
      { category: "operation", ref: "rxjs.map", value: runtimeCapability },
    ]),
    sinks: createRslRegistry("sink", [
      { category: "sink", ref: "rxjs.subscribe", value: runtimeCapability },
    ]),
    workers: createRslRegistry("worker", [
      { category: "worker", ref: "workers.double", value: runtimeCapability },
      { category: "worker", ref: "workers.render", value: runtimeCapability },
    ]),
  });
}

function codes(
  expression: RslExpression,
  registries = completeRegistries(),
): readonly RegistryDiagnosticCode[] {
  return validateRslReferences(expression, registries).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

void test("resolves each node against its category-specific registry", async () => {
  const resolved = resolveRslReferences(await fixture(), completeRegistries());

  assert.deepEqual(
    resolved.nodes.map((node) => node.operation.category),
    ["source", "operation", "sink"],
  );
  assert.deepEqual(
    resolved.nodes
      .filter((node) => node.worker !== undefined)
      .map((node) => node.worker?.ref),
    ["workers.double", "workers.render"],
  );
});

void test("registration and resolution never invoke runtime capabilities", async () => {
  let invocations = 0;
  const capability = (): void => {
    invocations += 1;
  };
  const registries = createRslRegistries({
    ...completeRegistries(),
    operations: createRslRegistry("operation", [
      { category: "operation", ref: "rxjs.map", value: capability },
    ]),
  });

  resolveRslReferences(await fixture(), registries);
  assert.equal(invocations, 0);
});

void test("rejects invalid and duplicate registry definitions", () => {
  assert.throws(
    () =>
      createRslRegistry("worker", [
        { category: "worker", ref: "bad ref", value: runtimeCapability },
      ]),
    (error: unknown) =>
      error instanceof RslRegistryError &&
      error.diagnostics[0]?.code === "REG-001_INVALID_REFERENCE",
  );
  assert.throws(
    () =>
      createRslRegistry("worker", [
        { category: "worker", ref: "workers.double", value: runtimeCapability },
        { category: "worker", ref: "workers.double", value: runtimeCapability },
      ]),
    (error: unknown) =>
      error instanceof RslRegistryError &&
      error.diagnostics[0]?.code === "REG-002_DUPLICATE_DEFINITION",
  );
});

void test("reports missing and wrong-category references", async () => {
  const expression = await fixture();
  const missingWorkers = createRslRegistries({
    ...completeRegistries(),
    workers: createRslRegistry("worker", []),
  });
  assert.ok(
    codes(expression, missingWorkers).includes("REG-003_MISSING_REFERENCE"),
  );

  const wrongSource = createRslRegistries({
    ...completeRegistries(),
    sources: createRslRegistry("source", []),
    operations: createRslRegistry("operation", [
      { category: "operation", ref: "rxjs.map", value: runtimeCapability },
      { category: "operation", ref: "rxjs.from", value: runtimeCapability },
    ]),
  });
  const result = validateRslReferences(expression, wrongSource);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      (item) =>
        item.code === "REG-006_WRONG_CATEGORY" &&
        item.path === "nodes[0].operation",
    ),
  );
});

void test("requires explicit versions when several definitions share a name", async () => {
  const expression = await fixture();
  const versioned = createRslRegistries({
    ...completeRegistries(),
    operations: createRslRegistry("operation", [
      { category: "operation", ref: "rxjs.map", version: "1", value: "v1" },
      { category: "operation", ref: "rxjs.map", version: "2", value: "v2" },
    ]),
  });
  assert.ok(
    codes(expression, versioned).includes("REG-004_AMBIGUOUS_REFERENCE"),
  );

  const [, pipeline] = expression.nodes;
  assert.ok(pipeline);
  const explicit: RslExpression = {
    ...expression,
    nodes: [
      expression.nodes[0],
      { ...pipeline, operation: { ...pipeline.operation, version: "2" } },
      ...expression.nodes.slice(2),
    ],
  };
  const resolved = resolveRslReferences(explicit, versioned);
  assert.equal(resolved.nodes[1]?.operation.definition.value, "v2");

  const explicitPipeline = explicit.nodes[1];
  assert.ok(explicitPipeline);
  const mismatch: RslExpression = {
    ...explicit,
    nodes: [
      explicit.nodes[0],
      {
        ...explicitPipeline,
        operation: { ...explicitPipeline.operation, version: "3" },
      },
      ...explicit.nodes.slice(2),
    ],
  };
  assert.ok(codes(mismatch, versioned).includes("REG-005_VERSION_MISMATCH"));
});

void test("recursively resolves named and generic TypeRefs plus schedulers", async () => {
  const expression = await fixture();
  const source = expression.nodes[0];
  assert.equal(source.kind, "source");
  const typedSource = {
    ...source,
    scheduler: { scheduler: { kind: "scheduler", ref: "schedulers.work" } },
    outputs: [
      {
        ...source.outputs[0],
        type: {
          kind: "generic",
          ref: "Result",
          arguments: [{ kind: "named", ref: "domain.User" }],
        },
      },
    ],
  } as const;
  const typed: RslExpression = {
    ...expression,
    nodes: [typedSource, ...expression.nodes.slice(1)],
  };
  const registries = createRslRegistries({
    ...completeRegistries(),
    schedulers: createRslRegistry("scheduler", [
      {
        category: "scheduler",
        ref: "schedulers.work",
        value: runtimeCapability,
      },
    ]),
    types: createRslRegistry("type", [
      { category: "type", ref: "Result", value: {} },
      { category: "type", ref: "domain.User", value: {} },
    ]),
  });
  const resolved = resolveRslReferences(typed, registries);

  assert.equal(resolved.nodes[0]?.scheduler?.ref, "schedulers.work");
  assert.deepEqual(
    resolved.types.map((type) => type.definition.ref),
    ["Result", "domain.User"],
  );
});
