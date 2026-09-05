import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { of } from "rxjs";

import {
  compileRsl,
  createRslRegistries,
  createRslRegistry,
  handlersSink,
  operationCombineLatest,
  operationSwitchMap,
  renderRslMermaid,
  RslRegistryError,
  RslSemanticError,
  RslStructuralError,
  RslYamlError,
  sourceFrom,
  sourceOf,
  stringifyRslExpression,
  type NodeOperationContract,
  type RslTraceEvent,
  type WorkerContract,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../conformance/fixtures/valid/asl-inspired-combined-search.rsl.yaml",
  import.meta.url,
);
const expectedMermaidUrl = new URL(
  "../conformance/expected/asl-inspired-combined-search.mmd",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);
const source = readFileSync(fixtureUrl, "utf8");
const legacySource = readFileSync(
  new URL(
    "../conformance/fixtures/valid/double-and-filter.rsl.yaml",
    import.meta.url,
  ),
  "utf8",
);

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

function releaseRegistries(next: unknown[], errors: unknown[]) {
  const tuple = {
    kind: "tuple",
    items: [
      { kind: "primitive", name: "string" },
      { kind: "primitive", name: "string" },
    ],
  } as const;
  return createRslRegistries({
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
        contract: {
          inputArity: { min: 1, max: 1 },
          outputArity: { min: 1, max: 1 },
          worker: {
            required: true,
            categories: ["observable-producing"],
          },
          constraints: [
            {
              source: { kind: "worker-output-value" },
              target: { kind: "node-output", index: 0 },
              relation: "equal",
            },
          ],
        },
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
        value: () => undefined,
        contract: effect("void"),
      },
    ]),
  });
}

void test("the v0.1 document compiler crosses every public conformance boundary", () => {
  const next: unknown[] = [];
  const errors: unknown[] = [];
  const trace: RslTraceEvent[] = [];
  const workflow = compileRsl(source, releaseRegistries(next, errors), {
    executionId: () => "release-execution",
    now: () => 19,
    trace: (event) => trace.push(event),
  });

  assert.deepEqual(next, []);
  assert.equal(trace.length, 0);
  assert.equal(
    renderRslMermaid(workflow.semanticEvidence.expression.expression),
    readFileSync(expectedMermaidUrl, "utf8"),
  );
  const canonical = stringifyRslExpression(
    workflow.semanticEvidence.expression.expression,
  );
  assert.equal(
    stringifyRslExpression(
      compileRsl(canonical, releaseRegistries([], [])).semanticEvidence
        .expression.expression,
    ),
    canonical,
  );

  workflow.definition.subscribe();

  assert.deepEqual(next, ["two:compact"]);
  assert.deepEqual(errors, []);
  assert.equal(trace[0]?.kind, "execution.started");
  assert.deepEqual(
    [
      ...new Set(
        trace.flatMap((event) =>
          event.kind === "node.subscribed" ? [event.nodeId] : [],
        ),
      ),
    ].sort(),
    ["Preferences", "Queries", "Render", "Search", "SearchContext"],
  );
  assert.deepEqual(trace.at(-1), {
    kind: "execution.finalized",
    outcome: "complete",
    sequence: trace.length - 1,
    time: 19,
    expressionId: "rsl-workflow",
    executionId: "release-execution",
  });
});

void test("the document compiler preserves stage-specific failures", () => {
  assert.throws(
    () => compileRsl("Version: 0.1\n", createRslRegistries()),
    (error) => error instanceof RslYamlError && error.code === "invalid-schema",
  );
  assert.throws(
    () =>
      compileRsl(
        legacySource.replace(
          "node: render-result\n        port: value",
          "node: numbers\n        port: value",
        ),
        createRslRegistries(),
      ),
    (error) => error instanceof RslStructuralError,
  );
  assert.throws(
    () => compileRsl(source, createRslRegistries()),
    (error) =>
      error instanceof RslRegistryError &&
      error.diagnostics.every((diagnostic) =>
        diagnostic.code.startsWith("REG-"),
      ),
  );
  assert.throws(
    () =>
      compileRsl(
        source.replace(
          "    Output:\n      Type: string\n    Next: Render",
          "    Output:\n      Type: number\n    Next: Render",
        ),
        releaseRegistries([], []),
      ),
    (error) => error instanceof RslSemanticError,
  );
});

void test("the v0.1 package exposes its built public API", () => {
  const manifest = JSON.parse(readFileSync(packageUrl, "utf8")) as {
    readonly version: string;
    readonly private?: boolean;
  };
  assert.equal(manifest.version, "0.1.0");
  assert.notEqual(manifest.private, true);

  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import { compileRsl, RSL_VERSION } from "@rxjs-rsl/core"; if (typeof compileRsl !== "function" || RSL_VERSION !== "0.1") process.exit(1);',
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
