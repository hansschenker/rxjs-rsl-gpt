import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertValidRslStructure,
  parseRslExpression,
  RslStructuralError,
  validateRslStructure,
  type Edge,
  type RslExpression,
  type RslNode,
  type StructuralDiagnosticCode,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../conformance/fixtures/valid/double-and-filter.rsl.yaml",
  import.meta.url,
);

async function fixture(): Promise<RslExpression> {
  return parseRslExpression(await readFile(fixtureUrl, "utf8"));
}

function codes(expression: RslExpression): readonly StructuralDiagnosticCode[] {
  return validateRslStructure(expression).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

void test("accepts the canonical graph and returns stable dependency order", async () => {
  const result = validateRslStructure(await fixture());
  assert.deepEqual(result, {
    valid: true,
    diagnostics: [],
    topologicalOrder: ["numbers", "double-numbers", "render-result"],
  });
});

void test("accepts multiple Sources, a multi-input Pipeline, fan-out, and multiple Sinks", () => {
  const numberType = { kind: "primitive", name: "number" } as const;
  const inputPort = (id: string) => ({
    direction: "input" as const,
    id,
    type: numberType,
  });
  const outputPort = (id: string) => ({
    direction: "output" as const,
    id,
    type: numberType,
  });
  const expression = {
    kind: "rsl-expression",
    version: "0.1",
    id: "multi-source-and-sink",
    nodes: [
      {
        kind: "source",
        id: "left",
        operation: { kind: "operation", ref: "rxjs.from" },
        inputs: [],
        outputs: [outputPort("value")],
      },
      {
        kind: "source",
        id: "right",
        operation: { kind: "operation", ref: "rxjs.from" },
        inputs: [],
        outputs: [outputPort("value")],
      },
      {
        kind: "pipeline",
        id: "combine",
        operation: { kind: "operation", ref: "rxjs.combineLatest" },
        inputs: [inputPort("left"), inputPort("right")],
        outputs: [outputPort("value")],
      },
      {
        kind: "sink",
        id: "render",
        operation: { kind: "operation", ref: "rxjs.subscribe" },
        inputs: [inputPort("value")],
        outputs: [],
      },
      {
        kind: "sink",
        id: "audit",
        operation: { kind: "operation", ref: "rxjs.subscribe" },
        inputs: [inputPort("value")],
        outputs: [],
      },
    ],
    edges: [
      {
        from: { direction: "output", node: "left", port: "value" },
        to: { direction: "input", node: "combine", port: "left" },
      },
      {
        from: { direction: "output", node: "right", port: "value" },
        to: { direction: "input", node: "combine", port: "right" },
      },
      {
        from: { direction: "output", node: "combine", port: "value" },
        to: { direction: "input", node: "render", port: "value" },
      },
      {
        from: { direction: "output", node: "combine", port: "value" },
        to: { direction: "input", node: "audit", port: "value" },
      },
    ],
  } as const satisfies RslExpression;

  assert.equal(validateRslStructure(expression).valid, true);
});

void test("reports identity, cardinality, polarity, and endpoint failures", async () => {
  const base = await fixture();
  const [source, pipeline, sink] = base.nodes;
  assert.ok(pipeline);
  assert.ok(sink);

  assert.ok(
    codes({ ...base, id: "bad id" }).includes("STR-001_INVALID_LOCAL_ID"),
  );
  assert.ok(
    codes({ ...base, nodes: [source, pipeline, sink, source] }).includes(
      "STR-002_DUPLICATE_NODE_ID",
    ),
  );
  assert.ok(
    codes({ ...base, nodes: [pipeline, sink] }).includes(
      "STR-004_MISSING_SOURCE",
    ),
  );
  assert.ok(
    codes({ ...base, nodes: [source, pipeline] }).includes(
      "STR-005_MISSING_SINK",
    ),
  );

  const invalidSource = {
    ...source,
    inputs: pipeline.inputs,
  } as unknown as RslNode;
  assert.ok(
    codes({ ...base, nodes: [invalidSource, pipeline, sink] }).includes(
      "STR-006_INVALID_NODE_POLARITY",
    ),
  );

  const reversed = {
    ...base.edges[0],
    from: { ...base.edges[0]?.from, direction: "input" },
  } as unknown as Edge;
  assert.ok(
    codes({ ...base, edges: [reversed, ...base.edges.slice(1)] }).includes(
      "STR-007_INVALID_EDGE_DIRECTION",
    ),
  );

  const unknownNode = {
    ...base.edges[0],
    from: { direction: "output", node: "missing", port: "value" },
  } as Edge;
  assert.ok(
    codes({ ...base, edges: [unknownNode, ...base.edges.slice(1)] }).includes(
      "STR-008_UNKNOWN_EDGE_NODE",
    ),
  );

  const unknownPort = {
    ...base.edges[0],
    from: { direction: "output", node: source.id, port: "missing" },
  } as Edge;
  assert.ok(
    codes({ ...base, edges: [unknownPort, ...base.edges.slice(1)] }).includes(
      "STR-009_UNKNOWN_EDGE_PORT",
    ),
  );
});

void test("reports connection cardinality, cycles, and reachability", async () => {
  const base = await fixture();
  const firstEdge = base.edges[0];
  assert.ok(firstEdge);

  assert.ok(
    codes({ ...base, edges: [...base.edges, firstEdge] }).includes(
      "STR-010_DUPLICATE_EDGE",
    ),
  );
  assert.ok(
    codes({ ...base, edges: base.edges.slice(1) }).includes(
      "STR-011_UNCONNECTED_INPUT",
    ),
  );
  assert.ok(
    codes({ ...base, edges: [...base.edges, firstEdge] }).includes(
      "STR-012_MULTIPLE_INPUT_EDGES",
    ),
  );
  assert.ok(
    codes({ ...base, edges: base.edges.slice(1) }).includes(
      "STR-013_UNUSED_OUTPUT",
    ),
  );

  const [source, pipeline, sink] = base.nodes;
  assert.ok(pipeline);
  assert.ok(sink);
  assert.equal(pipeline.kind, "pipeline");
  assert.equal(sink.kind, "sink");
  const loop = {
    kind: "pipeline",
    id: "loop",
    operation: pipeline.operation,
    inputs: pipeline.inputs,
    outputs: pipeline.outputs,
  } as const satisfies RslNode;
  const cyclic: RslExpression = {
    ...base,
    nodes: [source, pipeline, loop, sink],
    edges: [
      {
        from: {
          direction: "output",
          node: pipeline.id,
          port: pipeline.outputs[0].id,
        },
        to: { direction: "input", node: loop.id, port: loop.inputs[0].id },
      },
      {
        from: { direction: "output", node: loop.id, port: loop.outputs[0].id },
        to: {
          direction: "input",
          node: pipeline.id,
          port: pipeline.inputs[0].id,
        },
      },
      {
        from: { direction: "output", node: loop.id, port: loop.outputs[0].id },
        to: { direction: "input", node: sink.id, port: sink.inputs[0].id },
      },
    ],
  };
  const cyclicCodes = codes(cyclic);
  assert.ok(cyclicCodes.includes("STR-014_CYCLE"));
  assert.ok(cyclicCodes.includes("STR-015_NOT_REACHABLE_FROM_SOURCE"));
  assert.ok(cyclicCodes.includes("STR-016_CANNOT_REACH_SINK"));
});

void test("assertion API returns valid metadata or throws all diagnostics", async () => {
  const base = await fixture();
  assert.equal(assertValidRslStructure(base).valid, true);
  assert.throws(
    () => assertValidRslStructure({ ...base, edges: [] }),
    RslStructuralError,
  );
});
