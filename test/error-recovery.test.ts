import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Observable, of, throwError, type SchedulerLike } from "rxjs";
import { TestScheduler } from "rxjs/testing";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  handlersSink,
  operationCatchError,
  operationRetry,
  parseRslExpression,
  resolveRslReferences,
  type NodeOperationContract,
  type RslSourceCapability,
  type RslTraceEvent,
  type WorkerContract,
} from "../src/index.js";

const number = { kind: "primitive", name: "number" } as const;
const unknown = { kind: "primitive", name: "unknown" } as const;
const voidType = { kind: "primitive", name: "void" } as const;
const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});
const recoveryOperation: NodeOperationContract = {
  ...noWorker(1, 1),
  worker: {
    required: true,
    categories: ["observable-producing"],
    inputArity: { min: 1, max: 1 },
  },
  constraints: [
    {
      source: { kind: "node-input-error", index: 0 },
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
const recoveryWorker: WorkerContract = {
  category: "observable-producing",
  inputs: [unknown],
  output: { kind: "observable", value: number },
  purity: "effectful",
};
const handler = (): WorkerContract => ({
  category: "effect",
  inputs: [unknown],
  output: voidType,
  purity: "effectful",
});

const yaml = readFileSync(
  new URL(
    "../conformance/fixtures/valid/retry-and-recover.rsl.yaml",
    import.meta.url,
  ),
  "utf8",
);

void test("catchError YAML declares an Observable-producing recovery boundary", () => {
  const expression = parseRslExpression(yaml);
  const recovery = expression.nodes.find(
    (node) => node.id === "RecoverRequest",
  );
  assert.equal(recovery?.worker?.input?.kind, "primitive");
  assert.equal(recovery.worker.output?.kind, "observable");
  assert.deepEqual(recovery.worker.output.value, number);
});

void test("retry rejects invalid policy parameters", () => {
  assert.throws(
    () =>
      operationRetry({
        node: { id: "retry" } as never,
        parameters: { count: -1 },
      }),
    /non-negative integer/u,
  );
  assert.throws(
    () =>
      operationRetry({
        node: { id: "retry" } as never,
        parameters: { count: 1, backoffRate: 0.5 },
      }),
    /backoffRate/u,
  );
});

function compile(options: {
  source: RslSourceCapability;
  scheduler: SchedulerLike;
  recover: (error: unknown) => unknown;
  next?: (value: unknown) => void;
  error?: (error: unknown) => void;
  complete?: () => void;
  trace?: (event: RslTraceEvent) => void;
}) {
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "test.request",
        value: options.source,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.retry",
        value: operationRetry,
        contract: noWorker(1, 1),
      },
      {
        category: "operation",
        ref: "rxjs.catchError",
        value: operationCatchError,
        contract: recoveryOperation,
      },
    ]),
    sinks: createRslRegistry("sink", [
      {
        category: "sink",
        ref: "rsl.handlers",
        value: handlersSink,
        contract: noWorker(1, 0),
      },
    ]),
    workers: createRslRegistry("worker", [
      {
        category: "worker",
        ref: "workers.recoverRequest",
        value: options.recover,
        contract: recoveryWorker,
      },
      {
        category: "worker",
        ref: "handlers.next",
        value: options.next ?? (() => undefined),
        contract: handler(),
      },
      {
        category: "worker",
        ref: "handlers.error",
        value: options.error ?? (() => undefined),
        contract: handler(),
      },
      {
        category: "worker",
        ref: "handlers.complete",
        value: options.complete ?? (() => undefined),
        contract: handler(),
      },
    ]),
    schedulers: createRslRegistry("scheduler", [
      {
        category: "scheduler",
        ref: "schedulers.virtual",
        value: options.scheduler,
      },
    ]),
  });
  const expression = parseRslExpression(yaml);
  return compileRslGraph(
    assertValidRslSemantics(
      resolveRslReferences(expression, registries),
      registries,
    ),
    {
      ...(options.trace === undefined ? {} : { trace: options.trace }),
      now: () => options.scheduler.now(),
    },
  );
}

void test("retry resubscribes with scheduler-controlled exponential backoff", () => {
  const scheduler = new TestScheduler(() => undefined);
  const received: unknown[] = [];
  const events: RslTraceEvent[] = [];
  let attempts = 0;
  const workflow = compile({
    scheduler,
    source: () =>
      new Observable((subscriber) => {
        attempts += 1;
        if (attempts < 3)
          subscriber.error(new Error(`attempt ${String(attempts)}`));
        else {
          subscriber.next(42);
          subscriber.complete();
        }
      }),
    recover: () => of(99),
    next: (value) => received.push(value),
    trace: (event) => events.push(event),
  });

  workflow.definition.subscribe();
  assert.equal(attempts, 1);
  scheduler.flush();

  assert.equal(attempts, 3);
  assert.deepEqual(received, [42]);
  const retries = events.filter((event) => event.kind === "error.retry");
  assert.deepEqual(
    retries.map((event) => [event.retry, event.delay, event.time]),
    [
      [1, 10, 0],
      [2, 20, 10],
    ],
  );
  assert.equal(
    events.some((event) => event.kind === "error.recovery"),
    false,
  );
});

void test("catchError invokes one named Worker after retries are exhausted", () => {
  const scheduler = new TestScheduler(() => undefined);
  const sourceError = new Error("unavailable");
  const received: unknown[] = [];
  let attempts = 0;
  let recoveries = 0;
  const workflow = compile({
    scheduler,
    source: () =>
      new Observable((subscriber) => {
        attempts += 1;
        subscriber.error(sourceError);
      }),
    recover: (error) => {
      assert.equal(error, sourceError);
      recoveries += 1;
      return of(99);
    },
    next: (value) => received.push(value),
  });

  workflow.definition.subscribe();
  scheduler.flush();

  assert.equal(attempts, 3);
  assert.equal(recoveries, 1);
  assert.deepEqual(received, [99]);
});

void test("cancellation during backoff prevents retries and recovery", () => {
  const scheduler = new TestScheduler(() => undefined);
  let attempts = 0;
  let recoveries = 0;
  const events: RslTraceEvent[] = [];
  const workflow = compile({
    scheduler,
    source: () =>
      new Observable((subscriber) => {
        attempts += 1;
        subscriber.error(new Error("transient"));
      }),
    recover: () => {
      recoveries += 1;
      return of(99);
    },
    trace: (event) => events.push(event),
  });

  const subscription = workflow.definition.subscribe();
  subscription.unsubscribe();
  scheduler.flush();

  assert.equal(attempts, 1);
  assert.equal(recoveries, 0);
  const final = events.at(-1);
  assert.equal(final?.kind, "execution.finalized");
  assert.equal(final.outcome, "cancelled");
});

void test("an error from the recovery Observable remains terminal", () => {
  const scheduler = new TestScheduler(() => undefined);
  const recoveryError = new Error("recovery failed");
  let received: unknown;
  const workflow = compile({
    scheduler,
    source: () => throwError(() => new Error("source failed")),
    recover: () => throwError(() => recoveryError),
    error: (error) => {
      received = error;
    },
  });

  workflow.definition.subscribe({ error: () => undefined });
  scheduler.flush();

  assert.equal(received, recoveryError);
});
