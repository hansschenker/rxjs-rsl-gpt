import assert from "node:assert/strict";
import test from "node:test";

import { finalize, of, tap } from "rxjs";
import { TestScheduler } from "rxjs/testing";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  effectSink,
  operationConcatMap,
  operationExhaustMap,
  operationMergeMap,
  operationSwitchMap,
  resolveRslReferences,
  sourceOf,
  type CapabilityContext,
  type NodeOperationContract,
  type RslExpression,
  type RslUnaryOperationCapability,
} from "../src/index.js";

const operationNode = { id: "higher-order" } as never;

function policyTrace(
  operation: RslUnaryOperationCapability,
): readonly string[] {
  const scheduler = new TestScheduler(() => undefined);
  const trace: string[] = [];
  scheduler.run(({ cold, flush }) => {
    const source = cold("-a-b-c----|", { a: "a", b: "b", c: "c" });
    const context: CapabilityContext = {
      node: operationNode,
      parameters: {},
      worker: (value) => cold("---(x|)", { x: value }),
    };
    source.pipe(operation(context)).subscribe({
      next: (value) =>
        trace.push(`${String(scheduler.frame)}:${String(value)}`),
      complete: () => trace.push(`${String(scheduler.frame)}:complete`),
    });
    flush();
  });
  return trace;
}

void test("the four higher-order policies produce distinct virtual-time traces", () => {
  assert.deepEqual(policyTrace(operationMergeMap), [
    "4:a",
    "6:b",
    "8:c",
    "10:complete",
  ]);
  assert.deepEqual(policyTrace(operationSwitchMap), ["8:c", "10:complete"]);
  assert.deepEqual(policyTrace(operationConcatMap), [
    "4:a",
    "7:b",
    "10:c",
    "10:complete",
  ]);
  assert.deepEqual(policyTrace(operationExhaustMap), [
    "4:a",
    "8:c",
    "10:complete",
  ]);
});

void test("switchMap cancels stale inner work by teardown, not completion", () => {
  const scheduler = new TestScheduler(() => undefined);
  const completed: string[] = [];
  const tornDown: string[] = [];
  scheduler.run(({ cold, flush }) => {
    const source = cold("-a-b-c----|", { a: "a", b: "b", c: "c" });
    source
      .pipe(
        operationSwitchMap({
          node: operationNode,
          parameters: {},
          worker: (value) =>
            cold("---(x|)", { x: value }).pipe(
              tap({ complete: () => completed.push(String(value)) }),
              finalize(() => tornDown.push(String(value))),
            ),
        }),
      )
      .subscribe();
    flush();
  });
  assert.deepEqual(completed, ["c"]);
  assert.deepEqual(tornDown, ["a", "b", "c"]);
});

void test("mergeMap concurrency is explicit and execution-local", () => {
  const scheduler = new TestScheduler((actual, expected) => {
    assert.deepEqual(actual, expected);
  });
  scheduler.run(({ cold, expectObservable }) => {
    const source = cold("-a-b-c----|", { a: "a", b: "b", c: "c" });
    const operation = operationMergeMap({
      node: operationNode,
      parameters: { concurrency: 1 },
      worker: (value) => cold("---(x|)", { x: value }),
    });
    expectObservable(source.pipe(operation)).toBe("----a--b--(c|)", {
      a: "a",
      b: "b",
      c: "c",
    });
  });
  assert.throws(
    () =>
      operationMergeMap({
        node: operationNode,
        parameters: { concurrency: 0 },
        worker: () => [],
      }),
    /positive integer/u,
  );
});

void test("inner errors terminate the policy output", () => {
  const scheduler = new TestScheduler((actual, expected) => {
    assert.deepEqual(actual, expected);
  });
  scheduler.run(({ cold, expectObservable }) => {
    const source = cold("-a------|", { a: "a" });
    const operation = operationConcatMap({
      node: operationNode,
      parameters: {},
      worker: () => cold("--#", undefined, new Error("inner failure")),
    });
    expectObservable(source.pipe(operation)).toBe(
      "---#",
      undefined,
      new Error("inner failure"),
    );
  });
});

void test("the graph compiler keeps flattening policy outside the Worker", () => {
  const number = { kind: "primitive", name: "number" } as const;
  const expression: RslExpression = {
    kind: "rsl-expression",
    version: "0.1",
    id: "higher-order-workflow",
    nodes: [
      {
        kind: "source",
        id: "values",
        operation: { kind: "operation", ref: "rxjs.of" },
        parameters: { values: [1, 2] },
        inputs: [],
        outputs: [{ direction: "output", id: "value", type: number }],
      },
      {
        kind: "pipeline",
        id: "work",
        operation: { kind: "operation", ref: "rxjs.concatMap" },
        worker: { worker: { kind: "worker", ref: "workers.inner" } },
        inputs: [{ direction: "input", id: "value", type: number }],
        outputs: [{ direction: "output", id: "result", type: number }],
      },
      {
        kind: "sink",
        id: "result",
        operation: { kind: "operation", ref: "test.sink" },
        worker: { worker: { kind: "worker", ref: "workers.render" } },
        inputs: [{ direction: "input", id: "value", type: number }],
        outputs: [],
      },
    ],
    edges: [
      {
        from: { direction: "output", node: "values", port: "value" },
        to: { direction: "input", node: "work", port: "value" },
      },
      {
        from: { direction: "output", node: "work", port: "result" },
        to: { direction: "input", node: "result", port: "value" },
      },
    ],
  };
  const higherOrderContract: NodeOperationContract = {
    inputArity: { min: 1, max: 1 },
    outputArity: { min: 1, max: 1 },
    worker: { required: true, categories: ["observable-producing"] },
    constraints: [
      {
        source: { kind: "node-input", index: 0 },
        target: { kind: "worker-input", index: 0 },
        relation: "equal",
      },
      {
        source: { kind: "worker-output-value" },
        target: { kind: "node-output", index: 0 },
        relation: "equal",
      },
    ],
  };
  const rendered: unknown[] = [];
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "rxjs.of",
        value: sourceOf,
        contract: {
          inputArity: { min: 0, max: 0 },
          outputArity: { min: 1, max: 1 },
        },
      },
    ]),
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.concatMap",
        value: operationConcatMap,
        contract: higherOrderContract,
      },
    ]),
    sinks: createRslRegistry("sink", [
      {
        category: "sink",
        ref: "test.sink",
        value: effectSink,
        contract: {
          inputArity: { min: 1, max: 1 },
          outputArity: { min: 0, max: 0 },
          worker: { required: true, categories: ["effect"] },
        },
      },
    ]),
    workers: createRslRegistry("worker", [
      {
        category: "worker",
        ref: "workers.inner",
        value: (value: unknown) => of(Number(value) * 2),
        contract: {
          category: "observable-producing",
          inputs: [number],
          output: { kind: "observable", value: number },
          purity: "pure",
        },
      },
      {
        category: "worker",
        ref: "workers.render",
        value: (value: unknown) => {
          rendered.push(value);
        },
        contract: {
          category: "effect",
          inputs: [number],
          output: { kind: "primitive", name: "void" },
          purity: "effectful",
        },
      },
    ]),
  });
  const valid = assertValidRslSemantics(
    resolveRslReferences(expression, registries),
    registries,
  );
  compileRslGraph(valid).definition.subscribe();
  assert.deepEqual(rendered, [2, 4]);
});
