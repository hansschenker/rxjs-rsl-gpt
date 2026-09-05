import assert from "node:assert/strict";
import test from "node:test";

import { Observable } from "rxjs";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  effectSink,
  resolveRslReferences,
  sourceFrom,
  type NodeOperationContract,
  type RslExpression,
  type RslSourceCapability,
  type RslTraceEvent,
  type WorkerContract,
} from "../src/index.js";

const number = { kind: "primitive", name: "number" } as const;
const sourceContract: NodeOperationContract = {
  inputArity: { min: 0, max: 0 },
  outputArity: { min: 1, max: 1 },
};
const sinkContract: NodeOperationContract = {
  inputArity: { min: 1, max: 1 },
  outputArity: { min: 0, max: 0 },
  worker: { required: true, categories: ["effect"] },
};
const effectContract: WorkerContract = {
  category: "effect",
  inputs: [number],
  output: { kind: "primitive", name: "void" },
  purity: "effectful",
};

const expression: RslExpression = {
  kind: "rsl-expression",
  version: "0.1",
  id: "traced-flow",
  nodes: [
    {
      kind: "source",
      id: "values",
      operation: { kind: "operation", ref: "test.source" },
      parameters: { values: [1, 2] },
      inputs: [],
      outputs: [{ direction: "output", id: "value", type: number }],
    },
    {
      kind: "sink",
      id: "consume",
      operation: { kind: "operation", ref: "test.sink" },
      worker: { worker: { kind: "worker", ref: "workers.consume" } },
      inputs: [{ direction: "input", id: "value", type: number }],
      outputs: [],
    },
  ],
  edges: [
    {
      from: { direction: "output", node: "values", port: "value" },
      to: { direction: "input", node: "consume", port: "value" },
    },
  ],
};

function compile(
  source: RslSourceCapability,
  trace: (event: RslTraceEvent) => void,
) {
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "test.source",
        value: source,
        contract: sourceContract,
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
        ref: "workers.consume",
        value: () => undefined,
        contract: effectContract,
      },
    ]),
  });
  return compileRslGraph(
    assertValidRslSemantics(
      resolveRslReferences(expression, registries),
      registries,
    ),
    { trace, now: () => 42 },
  );
}

function lastEvent(events: readonly RslTraceEvent[]): RslTraceEvent {
  const event = events[events.length - 1];
  assert.ok(event);
  return event;
}

void test("traces an execution, node participation, notifications, and teardown", () => {
  const events: RslTraceEvent[] = [];
  const notifications: string[] = [];
  let expectedSequence = 0;
  const workflow = compile(sourceFrom, (event) => {
    assert.equal(event.sequence, expectedSequence++);
    if (event.kind === "node.notification" && event.nodeId === "consume") {
      notifications.push(event.notification);
    }
    events.push(event);
  });

  assert.equal(events.length, 0);
  workflow.definition.subscribe();

  assert.equal(events[0]?.kind, "execution.started");
  const final = lastEvent(events);
  assert.equal(final.kind, "execution.finalized");
  assert.equal(final.outcome, "complete");
  assert.ok(events.every((event) => event.time === 42));
  assert.ok(
    events.every((event) => event.executionId === events[0]?.executionId),
  );
  assert.deepEqual(notifications, ["next", "next", "complete"]);
});

void test("each cold subscription receives an independent trace identity", () => {
  const events: RslTraceEvent[] = [];
  const workflow = compile(sourceFrom, (event) => {
    events.push(event);
  });
  workflow.definition.subscribe();
  workflow.definition.subscribe();

  const starts = events.filter((event) => event.kind === "execution.started");
  assert.deepEqual(
    starts.map((event) => event.executionId),
    ["traced-flow:execution:1", "traced-flow:execution:2"],
  );
  assert.deepEqual(
    starts.map((event) => event.sequence),
    [0, 0],
  );
});

void test("unsubscription is traced as cancellation, never completion", () => {
  const events: RslTraceEvent[] = [];
  let teardown = 0;
  const workflow = compile(
    () =>
      new Observable(() => () => {
        teardown += 1;
      }),
    (event) => {
      events.push(event);
    },
  );

  const subscription = workflow.definition.subscribe();
  subscription.unsubscribe();

  assert.equal(teardown, 1);
  const final = lastEvent(events);
  assert.equal(final.kind, "execution.finalized");
  assert.equal(final.outcome, "cancelled");
  assert.equal(
    events.some(
      (event) =>
        event.kind === "node.notification" && event.notification === "complete",
    ),
    false,
  );
});

void test("errors are traced and trace observer failures cannot affect dataflow", () => {
  const events: RslTraceEvent[] = [];
  const failure = new Error("source failed");
  const workflow = compile(
    () =>
      new Observable((subscriber) => {
        subscriber.error(failure);
      }),
    (event) => {
      events.push(event);
      throw new Error("trace observer failed");
    },
  );
  let received: unknown;

  workflow.definition.subscribe({
    error: (error) => {
      received = error;
    },
  });

  assert.equal(received, failure);
  const final = lastEvent(events);
  assert.equal(final.kind, "execution.finalized");
  assert.equal(final.outcome, "error");
});
