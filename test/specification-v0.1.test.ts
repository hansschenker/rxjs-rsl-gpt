import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { of } from "rxjs";

import {
  assertValidRslSemantics,
  compileRslGraph,
  createRslRegistries,
  createRslRegistry,
  handlersSink,
  operationCombineLatest,
  operationSwitchMap,
  parseRslExpression,
  resolveRslReferences,
  sourceFrom,
  sourceOf,
  stringifyRslExpression,
  type NodeOperationContract,
  type WorkerContract,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../conformance/fixtures/valid/asl-inspired-combined-search.rsl.yaml",
  import.meta.url,
);

async function expression() {
  return parseRslExpression(await readFile(fixtureUrl, "utf8"));
}

const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});

const effect = (input: "string" | "unknown" | "void"): WorkerContract => ({
  category: "effect",
  inputs: [{ kind: "primitive", name: input }],
  output: { kind: "primitive", name: "void" },
  purity: "effectful",
});

void test("normalizes the ASL-inspired syntax into the typed graph", async () => {
  const value = await expression();

  assert.deepEqual(value.startAt, ["Queries", "Preferences"]);
  assert.deepEqual(
    value.nodes.map((node) => node.kind),
    ["source", "source", "pipeline", "pipeline", "sink"],
  );
  assert.equal(value.edges.length, 4);
  const combination = value.nodes.find((node) => node.id === "SearchContext");
  assert.ok(combination);
  assert.equal(combination.kind, "pipeline");
  assert.deepEqual(
    combination.inputs.map((port) => port.id),
    ["input-0", "input-1"],
  );
  const search = value.nodes.find((node) => node.id === "Search");
  assert.ok(search);
  assert.equal(search.kind, "pipeline");
  assert.deepEqual(search.innerSource, {
    createdBy: "worker",
    output: { kind: "primitive", name: "string" },
  });
  assert.deepEqual(search.concurrency, { policy: "latest", limit: 1 });
  const sourceOutput = value.nodes[0].outputs[0];
  assert.ok(sourceOutput);
  assert.deepEqual(sourceOutput.errorType, {
    kind: "primitive",
    name: "unknown",
  });
  assert.equal(sourceOutput.complete, true);
});

void test("serializes the normalized graph in stable ASL-inspired syntax", async () => {
  const first = stringifyRslExpression(await expression());
  const second = stringifyRslExpression(parseRslExpression(first));

  assert.equal(second, first);
  assert.match(first, /^Version: "0.1"/u);
  assert.match(first, /StartAt:\n {2}- Queries\n {2}- Preferences/u);
  assert.match(first, /Operation: rxjs\.combineLatest/u);
  assert.match(first, /InnerSource:/u);
  assert.match(first, /Policy: Latest/u);
  assert.match(first, /Handlers:/u);
});

void test("compiles combination, latest-inner policy, and all Sink handlers", async () => {
  const next: unknown[] = [];
  const errors: unknown[] = [];
  let completes = 0;
  const tuple = {
    kind: "tuple",
    items: [
      { kind: "primitive", name: "string" },
      { kind: "primitive", name: "string" },
    ],
  } as const;
  const higherOrder: NodeOperationContract = {
    inputArity: { min: 1, max: 1 },
    outputArity: { min: 1, max: 1 },
    worker: { required: true, categories: ["observable-producing"] },
    constraints: [
      {
        source: { kind: "worker-output-value" },
        target: { kind: "node-output", index: 0 },
        relation: "equal",
      },
    ],
  };
  const registries = createRslRegistries({
    sources: createRslRegistry("source", [
      {
        category: "source",
        ref: "rxjs.from",
        value: sourceFrom,
        contract: noWorker(0, 1),
      },
      {
        category: "source",
        ref: "rxjs.of",
        value: sourceOf,
        contract: noWorker(0, 1),
      },
    ]),
    operations: createRslRegistry<"operation", unknown>("operation", [
      {
        category: "operation",
        ref: "rxjs.combineLatest",
        value: operationCombineLatest,
        contract: noWorker(2, 1),
      },
      {
        category: "operation",
        ref: "rxjs.switchMap",
        value: operationSwitchMap,
        contract: higherOrder,
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
      {
        category: "worker",
        ref: "workers.search",
        value: ([query, preference]: readonly [string, string]) =>
          of(`${query}:${preference}`),
        contract: {
          category: "observable-producing",
          inputs: [tuple],
          output: {
            kind: "observable",
            value: { kind: "primitive", name: "string" },
          },
          purity: "effectful",
        },
      },
      {
        category: "worker",
        ref: "workers.render",
        value: (value: unknown) => next.push(value),
        contract: effect("string"),
      },
      {
        category: "worker",
        ref: "workers.renderError",
        value: (error: unknown) => errors.push(error),
        contract: effect("unknown"),
      },
      {
        category: "worker",
        ref: "workers.renderComplete",
        value: () => {
          completes += 1;
        },
        contract: effect("void"),
      },
    ]),
  });
  const resolved = resolveRslReferences(await expression(), registries);
  const valid = assertValidRslSemantics(resolved, registries);
  const workflow = compileRslGraph(valid);

  workflow.definition.subscribe();

  assert.deepEqual(next, ["two:compact"]);
  assert.deepEqual(errors, []);
  assert.equal(completes, 1);
});

void test("rejects a concurrency policy that contradicts its operator", () => {
  assert.throws(
    () =>
      parseRslExpression(`Version: "0.1"
StartAt: Values
Nodes:
  Values:
    Type: Source
    Operation: rxjs.of
    Arguments:
      - 1
    Output:
      Type: number
    Next: Work
  Work:
    Type: Pipeline
    Operation: rxjs.switchMap
    Worker: workers.work
    Input:
      Type: number
    InnerSource:
      Output:
        Type: number
    Concurrency:
      Policy: Queue
      Limit: 1
    Output:
      Type: number
    Next: Result
  Result:
    Type: Sink
    Input:
      Type: number
    End: true
`),
    /does not match rxjs\.switchMap/u,
  );
});
