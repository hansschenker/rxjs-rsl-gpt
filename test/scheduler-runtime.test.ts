import assert from "node:assert/strict";
import test from "node:test";

import { queueScheduler } from "rxjs";
import { TestScheduler } from "rxjs/testing";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  handlersSink,
  operationTake,
  parseRslExpression,
  resolveRslReferences,
  sourceInterval,
  sourceOf,
  type NodeOperationContract,
  type RslSourceCapability,
} from "../src/index.js";

const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});

const scheduledInterval = `Version: "0.1"
StartAt: Ticks
Nodes:
  Ticks:
    Type: Source
    Operation: rxjs.interval
    Arguments:
      Period: 10
    Scheduler: schedulers.virtual
    Output:
      Type: number
    Next: FirstThree
  FirstThree:
    Type: Pipeline
    Operation: rxjs.take
    Arguments:
      Count: 3
    Scheduler:
      SubscribeOn: schedulers.virtual
      ObserveOn: schedulers.virtual
    Input:
      Type: number
    Output:
      Type: number
    Next: Result
  Result:
    Type: Sink
    Scheduler:
      ObserveOn: schedulers.virtual
    Input:
      Type: number
    Handlers:
      Next: workers.next
      Error: workers.error
      Complete: workers.complete
    End: true
`;

function compile(
  source: RslSourceCapability,
  scheduler: unknown,
  handlers: {
    readonly next: (value: unknown) => void;
    readonly error: (error: unknown) => void;
    readonly complete: () => void;
  },
) {
  const expression = parseRslExpression(scheduledInterval);
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "rxjs.interval",
        value: source,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry("operation", [
      {
        category: "operation",
        ref: "rxjs.take",
        value: operationTake,
        contract: noWorker(1, 1),
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
    workers: createRslRegistry<"worker", unknown>("worker", [
      { category: "worker", ref: "workers.next", value: handlers.next },
      { category: "worker", ref: "workers.error", value: handlers.error },
      {
        category: "worker",
        ref: "workers.complete",
        value: handlers.complete,
      },
    ]),
    schedulers: createRslRegistry("scheduler", [
      { category: "scheduler", ref: "schedulers.virtual", value: scheduler },
    ]),
  });
  return compileRslGraph(
    assertValidRslSemantics(
      resolveRslReferences(expression, registries),
      registries,
    ),
  );
}

void test("operation, subscription, and notification schedulers run in virtual time", () => {
  const scheduler = new TestScheduler(() => undefined);
  const trace: string[] = [];
  const workflow = compile(sourceInterval, scheduler, {
    next: (value) => trace.push(`${String(scheduler.frame)}:${String(value)}`),
    error: (error) => trace.push(`error:${String(error)}`),
    complete: () => trace.push(`${String(scheduler.frame)}:complete`),
  });

  workflow.definition.subscribe();
  assert.deepEqual(trace, []);
  scheduler.flush();

  assert.deepEqual(trace, ["10:0", "20:1", "30:2", "30:complete"]);
});

void test("equal-time notifications preserve scheduling sequence order", () => {
  const scheduler = new TestScheduler(() => undefined);
  const trace: string[] = [];
  const source: RslSourceCapability = (context) =>
    sourceOf({ ...context, parameters: { values: [1, 2, 3] } });
  const workflow = compile(source, scheduler, {
    next: (value) => trace.push(`${String(scheduler.frame)}:${String(value)}`),
    error: () => undefined,
    complete: () => trace.push(`${String(scheduler.frame)}:complete`),
  });

  workflow.definition.subscribe();
  scheduler.flush();

  assert.deepEqual(trace, ["0:1", "0:2", "0:3", "0:complete"]);
});

void test("unsubscription cancels execution-owned scheduled actions", () => {
  const scheduler = new TestScheduler(() => undefined);
  const trace: unknown[] = [];
  const source: RslSourceCapability = (context) =>
    sourceOf({ ...context, parameters: { values: [1, 2, 3] } });
  const workflow = compile(source, scheduler, {
    next: (value) => trace.push(value),
    error: (error) => trace.push(error),
    complete: () => trace.push("complete"),
  });

  const execution = workflow.definition.subscribe();
  execution.unsubscribe();
  scheduler.flush();

  assert.deepEqual(trace, []);
});

void test("SubscribeOn defers Source activation until the scheduler runs", () => {
  const scheduler = new TestScheduler(() => undefined);
  let activations = 0;
  const source: RslSourceCapability = (context) => {
    activations += 1;
    return sourceOf({ ...context, parameters: { values: [] } });
  };
  const workflow = compile(source, scheduler, {
    next: () => undefined,
    error: () => undefined,
    complete: () => undefined,
  });

  workflow.definition.subscribe();
  assert.equal(activations, 0);
  scheduler.flush();
  assert.equal(activations, 1);
});

void test("queueScheduler provides the same deterministic equal-time order", () => {
  const trace: unknown[] = [];
  const source: RslSourceCapability = (context) =>
    sourceOf({ ...context, parameters: { values: [1, 2, 3] } });
  const workflow = compile(source, queueScheduler, {
    next: (value) => trace.push(value),
    error: (error) => trace.push(error),
    complete: () => trace.push("complete"),
  });

  workflow.definition.subscribe();
  assert.deepEqual(trace, [1, 2, 3, "complete"]);
});

void test("compiler rejects registry values that are not SchedulerLike", () => {
  assert.throws(
    () =>
      compile(
        sourceInterval,
        { schedule: "not-a-function" },
        {
          next: () => undefined,
          error: () => undefined,
          complete: () => undefined,
        },
      ),
    /not SchedulerLike/u,
  );
});

void test("scheduler bindings round-trip through ASL-inspired YAML", () => {
  const expression = parseRslExpression(scheduledInterval);
  const sourceScheduler = expression.nodes[0].scheduler;
  assert.equal(sourceScheduler?.operation?.ref, "schedulers.virtual");
  const pipelineNode = expression.nodes[1];
  assert.ok(pipelineNode);
  const pipelineScheduler = pipelineNode.scheduler;
  assert.equal(pipelineScheduler?.subscribeOn?.ref, "schedulers.virtual");
  assert.equal(pipelineScheduler.observeOn?.ref, "schedulers.virtual");
});
