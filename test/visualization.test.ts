import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createRslDebugSnapshot,
  parseRslExpression,
  renderRslMermaid,
  type RslExpression,
  type RslTraceEvent,
} from "../src/index.js";

const fixture = readFileSync(
  new URL(
    "../conformance/fixtures/valid/asl-inspired-combined-search.rsl.yaml",
    import.meta.url,
  ),
  "utf8",
);
const expectedMermaid = readFileSync(
  new URL(
    "../conformance/expected/asl-inspired-combined-search.mmd",
    import.meta.url,
  ),
  "utf8",
);

void test("renders the canonical graph as deterministic Mermaid", () => {
  const expression = parseRslExpression(fixture);
  const rendered = renderRslMermaid(expression);

  assert.equal(rendered, expectedMermaid);
  assert.equal(rendered.match(/ -->\|/gu)?.length, expression.edges.length);
});

void test("declaration order cannot change the visualization", () => {
  const expression = parseRslExpression(fixture);
  const last = expression.nodes.at(-1);
  assert.ok(last);
  const reordered: RslExpression = {
    ...expression,
    nodes: [last, ...expression.nodes.slice(0, -1)],
    edges: [...expression.edges].reverse(),
  };

  assert.equal(renderRslMermaid(reordered), renderRslMermaid(expression));
});

void test("escapes labels without changing declared topology", () => {
  const expression = parseRslExpression(fixture);
  const first = expression.nodes[0];
  assert.ok(first);
  const escaped: RslExpression = {
    ...expression,
    nodes: [{ ...first, id: 'unsafe"<node>' }, ...expression.nodes.slice(1)],
    edges: expression.edges.map((edge) => ({
      ...edge,
      from:
        edge.from.node === first.id
          ? { ...edge.from, node: 'unsafe"<node>' }
          : edge.from,
      to:
        edge.to.node === first.id
          ? { ...edge.to, node: 'unsafe"<node>' }
          : edge.to,
    })),
  };

  const rendered = renderRslMermaid(escaped);
  assert.match(rendered, /unsafe&quot;&lt;node&gt;/u);
  assert.equal(rendered.match(/ -->\|/gu)?.length, escaped.edges.length);
});

void test("renderer refuses to hide an edge with a missing endpoint", () => {
  const expression = parseRslExpression(fixture);
  const edge = expression.edges[0];
  assert.ok(edge);
  const invalid: RslExpression = {
    ...expression,
    edges: [{ ...edge, to: { ...edge.to, node: "missing" } }],
  };

  assert.throws(() => renderRslMermaid(invalid), /missing node/u);
});

const trace = [
  {
    kind: "execution.started",
    sequence: 0,
    time: 0,
    expressionId: "flow",
    executionId: "execution-1",
  },
  {
    kind: "node.subscribed",
    sequence: 1,
    time: 0,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "request",
    subscriptionId: "request-1",
  },
  {
    kind: "scheduler.bound",
    sequence: 2,
    time: 0,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "request",
    role: "operation",
    schedulerRef: "schedulers.virtual",
  },
  {
    kind: "node.notification",
    sequence: 3,
    time: 10,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "request",
    subscriptionId: "request-1",
    notification: "next",
    value: 42,
  },
  {
    kind: "error.retry",
    sequence: 4,
    time: 20,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "retry",
    retry: 1,
    delay: 10,
    value: "transient",
  },
  {
    kind: "error.recovery",
    sequence: 5,
    time: 30,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "recover",
    value: "unavailable",
  },
  {
    kind: "node.notification",
    sequence: 6,
    time: 30,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "request",
    subscriptionId: "request-1",
    notification: "complete",
  },
  {
    kind: "node.finalized",
    sequence: 7,
    time: 30,
    expressionId: "flow",
    executionId: "execution-1",
    nodeId: "request",
    subscriptionId: "request-1",
    outcome: "complete",
  },
  {
    kind: "execution.finalized",
    sequence: 8,
    time: 30,
    expressionId: "flow",
    executionId: "execution-1",
    outcome: "complete",
  },
] as const satisfies readonly RslTraceEvent[];

void test("folds one execution trace into a stable debugger snapshot", () => {
  assert.deepEqual(createRslDebugSnapshot(trace), {
    expressionId: "flow",
    executionId: "execution-1",
    status: "complete",
    firstSequence: 0,
    lastSequence: 8,
    eventCount: 9,
    nodes: [
      {
        nodeId: "recover",
        subscriptions: 0,
        activeSubscriptions: 0,
        nextCount: 0,
        outcomes: { complete: 0, error: 0, cancelled: 0 },
        schedulers: [],
        retries: 0,
        recoveries: 1,
      },
      {
        nodeId: "request",
        subscriptions: 1,
        activeSubscriptions: 0,
        nextCount: 1,
        lastNotification: "complete",
        lastValue: 42,
        outcomes: { complete: 1, error: 0, cancelled: 0 },
        schedulers: ["operation:schedulers.virtual"],
        retries: 0,
        recoveries: 0,
      },
      {
        nodeId: "retry",
        subscriptions: 0,
        activeSubscriptions: 0,
        nextCount: 0,
        outcomes: { complete: 0, error: 0, cancelled: 0 },
        schedulers: [],
        retries: 1,
        recoveries: 0,
      },
    ],
  });
});

void test("debugger rejects mixed executions and unordered traces", () => {
  assert.throws(
    () =>
      createRslDebugSnapshot([
        trace[0],
        { ...trace[1], executionId: "execution-2" },
      ]),
    /only one execution/u,
  );
  assert.throws(
    () => createRslDebugSnapshot([trace[1], trace[0]]),
    /increasing sequence/u,
  );
});
