import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { from, mergeMap, Observable } from "rxjs";

import {
  assertValidRslSemantics,
  compileRslUnary,
  createRslRegistries,
  createRslRegistry,
  effectSink,
  observerSink,
  operationMap,
  parseRslExpression,
  resolveRslReferences,
  sourceFrom,
  sourceDefer,
  type NodeOperationContract,
  type RslSinkCapability,
  type RslSourceCapability,
  type RslUnaryOperationCapability,
  type WorkerContract,
} from "../src/index.js";

const number = { kind: "primitive", name: "number" } as const;
const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});
const operationContract: NodeOperationContract = {
  inputArity: { min: 1, max: 1 },
  outputArity: { min: 1, max: 1 },
  worker: {
    required: true,
    categories: ["transformation"],
    inputArity: { min: 1, max: 1 },
  },
  constraints: [
    {
      source: { kind: "node-input", index: 0 },
      target: { kind: "worker-input", index: 0 },
      relation: "equal",
    },
    {
      source: { kind: "worker-output" },
      target: { kind: "node-output", index: 0 },
      relation: "equal",
    },
  ],
};
const sinkContract: NodeOperationContract = {
  inputArity: { min: 1, max: 1 },
  outputArity: { min: 0, max: 0 },
  worker: { required: true, categories: ["effect"] },
  constraints: [
    {
      source: { kind: "node-input", index: 0 },
      target: { kind: "worker-input", index: 0 },
      relation: "equal",
    },
  ],
};

const workerContract = (
  category: "transformation" | "effect",
  output = category === "effect"
    ? ({ kind: "primitive", name: "void" } as const)
    : number,
): WorkerContract => ({
  category,
  inputs: [number],
  output,
  purity: category === "effect" ? "effectful" : "pure",
});

async function expression() {
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

function runtime(options: {
  readonly source?: RslSourceCapability;
  readonly operation?: RslUnaryOperationCapability;
  readonly double?: (value: unknown) => unknown;
  readonly sink?: RslSinkCapability;
  readonly render?: (value: unknown) => unknown;
}) {
  return createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "rxjs.from",
        value: options.source ?? sourceFrom,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.map",
        value: options.operation ?? operationMap,
        contract: operationContract,
      },
    ]),
    sinks: createRslRegistry("sink", [
      {
        category: "sink",
        ref: "rxjs.subscribe",
        value: options.sink ?? effectSink,
        contract: sinkContract,
      },
    ]),
    workers: createRslRegistry("worker", [
      {
        category: "worker",
        ref: "workers.double",
        value: options.double ?? ((value: unknown) => Number(value) * 2),
        contract: workerContract("transformation"),
      },
      {
        category: "worker",
        ref: "workers.render",
        value: options.render ?? (() => undefined),
        contract: workerContract("effect"),
      },
    ]),
  });
}

async function compile(options: Parameters<typeof runtime>[0]) {
  const document = await expression();
  const registries = runtime(options);
  const resolved = resolveRslReferences(document, registries);
  return compileRslUnary(assertValidRslSemantics(resolved, registries));
}

void test("compilation is lazy and each subscription creates a cold execution", async () => {
  let sources = 0;
  let operations = 0;
  let workers = 0;
  const rendered: unknown[] = [];
  const workflow = await compile({
    source: (context) => {
      sources += 1;
      return sourceFrom(context);
    },
    operation: (context) => {
      operations += 1;
      return operationMap(context);
    },
    double: (value) => {
      workers += 1;
      return Number(value) * 2;
    },
    render: (value) => {
      rendered.push(value);
    },
  });

  assert.deepEqual(
    { sources, operations, workers, rendered },
    {
      sources: 0,
      operations: 0,
      workers: 0,
      rendered: [],
    },
  );
  workflow.definition.subscribe();
  workflow.definition.subscribe();
  assert.deepEqual(rendered, [2, 4, 6, 2, 4, 6]);
  assert.deepEqual(
    { sources, operations, workers },
    {
      sources: 2,
      operations: 2,
      workers: 6,
    },
  );
});

void test("preserves zero-to-many cardinality and completion", async () => {
  const rendered: unknown[] = [];
  let completed = 0;
  const workflow = await compile({
    operation: (context) =>
      mergeMap((value) =>
        from(Number(value) === 2 ? [] : [context.worker?.(value)]),
      ),
    render: (value) => {
      rendered.push(value);
    },
  });
  workflow.definition.subscribe({
    complete: () => {
      completed += 1;
    },
  });
  assert.deepEqual(rendered, [2, 6]);
  assert.equal(completed, 1);
});

void test("propagates errors and composes owned teardown on unsubscribe", async () => {
  let teardown = 0;
  let completed = 0;
  let receivedError: unknown;
  const failing = await compile({
    double: () => {
      throw new Error("domain failure");
    },
  });
  failing.definition.subscribe({
    error: (error: unknown) => {
      receivedError = error;
    },
  });
  assert.match(String(receivedError), /domain failure/u);

  const ongoing = await compile({
    source: () =>
      new Observable<number>((subscriber) => {
        subscriber.next(1);
        const timer = setInterval(() => {
          subscriber.next(1);
        }, 5);
        return () => {
          clearInterval(timer);
          teardown += 1;
        };
      }),
  });
  const subscription = ongoing.definition.subscribe({
    complete: () => {
      completed += 1;
    },
  });
  subscription.unsubscribe();
  assert.equal(teardown, 1);
  assert.equal(completed, 0);
});

void test("deferred Sources and Observer Sinks remain subscription-bound", () => {
  let activations = 0;
  const values: unknown[] = [];
  const source = sourceDefer({
    node: { id: "deferred" } as never,
    parameters: {},
    worker: () => {
      activations += 1;
      return [1, 2, 3];
    },
  });
  const sink = observerSink({ next: (value) => values.push(value) });
  const definition = sink(
    new Observable((subscriber) => from(source).subscribe(subscriber)),
    { node: { id: "observer" } as never, parameters: {} },
  );
  assert.equal(activations, 0);
  definition.subscribe();
  definition.subscribe();
  assert.equal(activations, 2);
  assert.deepEqual(values, [1, 2, 3, 1, 2, 3]);
});
