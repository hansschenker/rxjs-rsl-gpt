import assert from "node:assert/strict";
import test from "node:test";

import { Observable } from "rxjs";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  effectSink,
  operationCombineLatest,
  operationForkJoin,
  operationShare,
  operationTakeUntil,
  resolveRslReferences,
  sourceFrom,
  type NodeOperationContract,
  type RslExpression,
  type RslMultiInputOperationCapability,
  type RslSourceCapability,
  type WorkerContract,
} from "../src/index.js";

const number = { kind: "primitive", name: "number" } as const;
const string = { kind: "primitive", name: "string" } as const;
const pair = { kind: "tuple", items: [number, string] } as const;
const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});
const sinkContract: NodeOperationContract = {
  ...noWorker(1, 0),
  worker: { required: true, categories: ["effect"] },
};

function graph(shared = false): RslExpression {
  const nodes: RslExpression["nodes"] = [
    {
      kind: "source",
      id: "numbers",
      operation: { kind: "operation", ref: "test.source" },
      parameters: { values: [1, 2] },
      inputs: [],
      outputs: [{ direction: "output", id: "value", type: number }],
    },
    {
      kind: "source",
      id: "letters",
      operation: { kind: "operation", ref: "test.source" },
      parameters: { values: ["a", "b"] },
      inputs: [],
      outputs: [{ direction: "output", id: "value", type: string }],
    },
    {
      kind: "pipeline",
      id: "coordinate",
      operation: { kind: "operation", ref: "test.coordinate" },
      inputs: [
        { direction: "input", id: "number", type: number },
        { direction: "input", id: "letter", type: string },
      ],
      outputs: [{ direction: "output", id: "pair", type: pair }],
    },
    ...(shared
      ? ([
          {
            kind: "pipeline",
            id: "shared",
            operation: { kind: "operation", ref: "rxjs.share" },
            inputs: [{ direction: "input", id: "pair", type: pair }],
            outputs: [{ direction: "output", id: "pair", type: pair }],
          },
        ] as const)
      : []),
    {
      kind: "sink",
      id: "left",
      operation: { kind: "operation", ref: "test.sink" },
      worker: { worker: { kind: "worker", ref: "workers.left" } },
      inputs: [{ direction: "input", id: "pair", type: pair }],
      outputs: [],
    },
    {
      kind: "sink",
      id: "right",
      operation: { kind: "operation", ref: "test.sink" },
      worker: { worker: { kind: "worker", ref: "workers.right" } },
      inputs: [{ direction: "input", id: "pair", type: pair }],
      outputs: [],
    },
  ];
  const branch = shared ? "shared" : "coordinate";
  return {
    kind: "rsl-expression",
    version: "0.1",
    id: shared ? "shared-graph" : "cold-graph",
    nodes,
    edges: [
      {
        from: { direction: "output", node: "numbers", port: "value" },
        to: { direction: "input", node: "coordinate", port: "number" },
      },
      {
        from: { direction: "output", node: "letters", port: "value" },
        to: { direction: "input", node: "coordinate", port: "letter" },
      },
      ...(shared
        ? [
            {
              from: {
                direction: "output" as const,
                node: "coordinate",
                port: "pair",
              },
              to: {
                direction: "input" as const,
                node: "shared",
                port: "pair",
              },
            },
          ]
        : []),
      {
        from: { direction: "output", node: branch, port: "pair" },
        to: { direction: "input", node: "left", port: "pair" },
      },
      {
        from: { direction: "output", node: branch, port: "pair" },
        to: { direction: "input", node: "right", port: "pair" },
      },
    ],
  };
}

function run(
  expression: RslExpression,
  coordinate: RslMultiInputOperationCapability,
  source: RslSourceCapability,
) {
  const left: unknown[] = [];
  const right: unknown[] = [];
  const effect = (): WorkerContract => ({
    category: "effect",
    inputs: [pair],
    output: { kind: "primitive", name: "void" },
    purity: "effectful",
  });
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "test.source",
        value: source,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry<"operation", unknown>("operation", [
      {
        category: "operation",
        ref: "test.coordinate",
        value: coordinate,
        contract: noWorker(2, 1),
      },
      {
        category: "operation",
        ref: "rxjs.share",
        value: operationShare,
        contract: noWorker(1, 1),
      },
    ]),
    sinks: createRslRegistry("sink", [
      {
        category: "sink",
        ref: "test.sink",
        value: effectSink,
        contract: sinkContract,
      },
    ]),
    workers: createRslRegistry("worker", [
      {
        category: "worker",
        ref: "workers.left",
        value: (value: unknown) => {
          left.push(value);
        },
        contract: effect(),
      },
      {
        category: "worker",
        ref: "workers.right",
        value: (value: unknown) => {
          right.push(value);
        },
        contract: effect(),
      },
    ]),
  });
  const valid = assertValidRslSemantics(
    resolveRslReferences(expression, registries),
    registries,
  );
  return { workflow: compileRslGraph(valid), left, right };
}

void test("coordinates Sources in declared port order", () => {
  const combined = run(graph(), operationCombineLatest, sourceFrom);
  combined.workflow.definition.subscribe();
  assert.deepEqual(combined.left, [
    [2, "a"],
    [2, "b"],
  ]);
  assert.deepEqual(combined.right, combined.left);

  const joined = run(graph(), operationForkJoin, sourceFrom);
  joined.workflow.definition.subscribe();
  assert.deepEqual(joined.left, [[2, "b"]]);
  assert.deepEqual(joined.right, joined.left);
});

void test("fan-out stays cold unless sharing is declared", async () => {
  const activations = new Map<string, number>();
  const delayed: RslSourceCapability = (context) =>
    new Observable((subscriber) => {
      activations.set(
        context.node.id,
        (activations.get(context.node.id) ?? 0) + 1,
      );
      queueMicrotask(() => {
        for (const value of context.parameters.values as readonly unknown[])
          subscriber.next(value);
        subscriber.complete();
      });
    });

  const cold = run(graph(), operationCombineLatest, delayed);
  await new Promise<void>((resolve, reject) =>
    cold.workflow.definition.subscribe({ complete: resolve, error: reject }),
  );
  assert.deepEqual(Object.fromEntries(activations), { numbers: 2, letters: 2 });

  activations.clear();
  const shared = run(graph(true), operationCombineLatest, delayed);
  await new Promise<void>((resolve, reject) =>
    shared.workflow.definition.subscribe({ complete: resolve, error: reject }),
  );
  assert.deepEqual(Object.fromEntries(activations), { numbers: 1, letters: 1 });
  assert.deepEqual(shared.left, shared.right);
});

void test("takeUntil treats the notifier as an explicit second input", () => {
  const values = new Observable<number>((subscriber) => {
    subscriber.next(1);
    subscriber.next(2);
    subscriber.complete();
  });
  const notifier = new Observable<void>((subscriber) => {
    subscriber.next();
    subscriber.complete();
  });
  const result: unknown[] = [];
  operationTakeUntil([values, notifier], {
    node: { id: "take-until" } as never,
    parameters: {},
  }).subscribe({ next: (value) => result.push(value) });
  assert.deepEqual(result, []);
});
