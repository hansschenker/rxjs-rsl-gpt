import assert from "node:assert/strict";
import test from "node:test";

import type {
  PipelineNode,
  PortTypeRef,
  RslExpression,
  SinkNode,
  SourceNode,
  TypeRef,
} from "../src/index.js";

const numberType = { kind: "primitive", name: "number" } as const;
const booleanType = { kind: "primitive", name: "boolean" } as const;

const source: SourceNode = {
  kind: "source",
  id: "numbers",
  operation: { kind: "operation", ref: "source.from-array" },
  parameters: { values: [1, 2, 3] },
  inputs: [],
  outputs: [{ direction: "output", id: "value", type: numberType }],
};

const pipeline: PipelineNode = {
  kind: "pipeline",
  id: "greater-than-two",
  operation: { kind: "operation", ref: "filter" },
  worker: {
    worker: { kind: "worker", ref: "is-greater-than-two" },
    contract: {
      category: "predicate",
      inputs: [numberType],
      output: booleanType,
      purity: "pure",
    },
  },
  inputs: [{ direction: "input", id: "value", type: numberType }],
  outputs: [{ direction: "output", id: "value", type: numberType }],
};

const sink: SinkNode = {
  kind: "sink",
  id: "render",
  operation: { kind: "operation", ref: "sink.for-each" },
  worker: {
    worker: { kind: "worker", ref: "render-number" },
    contract: {
      category: "effect",
      inputs: [numberType],
      output: { kind: "primitive", name: "void" },
      purity: "effectful",
    },
  },
  inputs: [{ direction: "input", id: "value", type: numberType }],
  outputs: [],
};

const expression: RslExpression = {
  kind: "rsl-expression",
  version: "0.1",
  id: "filter-and-render",
  nodes: [source, pipeline, sink],
  edges: [
    {
      from: { direction: "output", node: "numbers", port: "value" },
      to: { direction: "input", node: "greater-than-two", port: "value" },
    },
    {
      from: {
        direction: "output",
        node: "greater-than-two",
        port: "value",
      },
      to: { direction: "input", node: "render", port: "value" },
    },
  ],
};

void test("represents a normalized expression with explicit topology", () => {
  assert.equal(expression.nodes.length, 3);
  assert.equal(expression.edges.length, 2);
  assert.deepEqual(
    expression.nodes.map((node) => node.kind),
    ["source", "pipeline", "sink"],
  );
});

void test("represents compound and Observable-producing Worker types", () => {
  const result: TypeRef = {
    kind: "observable",
    value: {
      kind: "record",
      fields: {
        id: { kind: "named", ref: "example.UserId" },
        tags: { kind: "array", items: { kind: "primitive", name: "string" } },
      },
    },
  };

  assert.equal(result.kind, "observable");
});

const invalidSource: SourceNode = {
  ...source,
  // @ts-expect-error Source polarity forbids input ports.
  inputs: [{ direction: "input", id: "in", type: numberType }],
};
const invalidSink: SinkNode = {
  ...sink,
  // @ts-expect-error Sink polarity forbids output ports.
  outputs: [{ direction: "output", id: "out", type: numberType }],
};
// @ts-expect-error Pipeline input lists are non-empty.
const invalidPipeline: PipelineNode = { ...pipeline, inputs: [] };
// @ts-expect-error void is a Worker return, not a dataflow port type.
const invalidVoidPort: PortTypeRef = { kind: "primitive", name: "void" };

assert.equal(
  [invalidSource, invalidSink, invalidPipeline, invalidVoidPort].length,
  4,
);
