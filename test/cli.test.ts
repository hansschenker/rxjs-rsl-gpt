import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  parseRslExpression,
  renderRslMermaid,
  renderRslTimelineMermaid,
  runRslCli,
  stringifyRslExpression,
  type RslCliIo,
} from "../src/index.js";

const fixturePath = new URL(
  "../conformance/fixtures/valid/asl-inspired-combined-search.rsl.yaml",
  import.meta.url,
);
const fixture = readFileSync(fixturePath, "utf8");

function memoryIo(files: Readonly<Record<string, string>>) {
  const stored = new Map(Object.entries(files));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: RslCliIo = {
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    read: (path) => {
      const value = stored.get(path);
      return value === undefined
        ? Promise.reject(new Error(`missing ${path}`))
        : Promise.resolve(value);
    },
    write: (path, content) => {
      stored.set(path, content);
      return Promise.resolve();
    },
  };
  return { io, stored, stdout, stderr };
}

void test("validate reports graph size without executing the workflow", async () => {
  const memory = memoryIo({ "flow.rsl.yaml": fixture });
  const code = await runRslCli(["validate", "flow.rsl.yaml"], memory.io);

  assert.equal(code, 0);
  assert.deepEqual(memory.stderr, []);
  assert.match(
    memory.stdout.join(""),
    /^valid rsl-workflow nodes=5 edges=4$/mu,
  );
});

void test("format supports stdout, check, and explicit write modes", async () => {
  const canonical = stringifyRslExpression(parseRslExpression(fixture));
  const memory = memoryIo({
    "canonical.rsl.yaml": canonical,
    "noncanonical.rsl.yaml": fixture,
  });

  assert.equal(
    await runRslCli(["format", "canonical.rsl.yaml", "--check"], memory.io),
    0,
  );
  assert.equal(
    await runRslCli(["format", "noncanonical.rsl.yaml", "--check"], memory.io),
    1,
  );
  assert.equal(
    await runRslCli(["format", "noncanonical.rsl.yaml", "--write"], memory.io),
    0,
  );
  assert.equal(memory.stored.get("noncanonical.rsl.yaml"), canonical);

  memory.stdout.length = 0;
  assert.equal(await runRslCli(["format", "canonical.rsl.yaml"], memory.io), 0);
  assert.equal(memory.stdout.join(""), canonical);
});

void test("visualize and inspect produce deterministic developer artifacts", async () => {
  const memory = memoryIo({ "flow.rsl.yaml": fixture });
  assert.equal(
    await runRslCli(
      ["visualize", "flow.rsl.yaml", "--output", "flow.mmd"],
      memory.io,
    ),
    0,
  );
  assert.equal(
    memory.stored.get("flow.mmd"),
    renderRslMermaid(parseRslExpression(fixture)),
  );

  assert.equal(await runRslCli(["inspect", "flow.rsl.yaml"], memory.io), 0);
  const report = JSON.parse(memory.stdout.at(-1) ?? "null") as {
    readonly valid: boolean;
    readonly edgeCount: number;
  };
  assert.equal(report.valid, true);
  assert.equal(report.edgeCount, 4);
});

void test("visualize renders notification values from a saved trace", async () => {
  const trace = JSON.stringify([
    {
      kind: "execution.started",
      sequence: 0,
      time: 0,
      expressionId: "rsl-workflow",
      executionId: "execution-1",
    },
    {
      kind: "node.notification",
      sequence: 1,
      time: 2,
      expressionId: "rsl-workflow",
      executionId: "execution-1",
      nodeId: "Render",
      subscriptionId: "execution-1:Render:1",
      notification: { kind: "next", value: 6 },
    },
    {
      kind: "node.notification",
      sequence: 2,
      time: 3,
      expressionId: "rsl-workflow",
      executionId: "execution-1",
      nodeId: "Render",
      subscriptionId: "execution-1:Render:1",
      notification: { kind: "complete" },
    },
    {
      kind: "execution.finalized",
      sequence: 3,
      time: 3,
      expressionId: "rsl-workflow",
      executionId: "execution-1",
      outcome: "complete",
    },
  ]);
  const memory = memoryIo({ "flow.rsl.yaml": fixture, "trace.json": trace });

  assert.equal(
    await runRslCli(
      [
        "visualize",
        "flow.rsl.yaml",
        "--trace",
        "trace.json",
        "--node",
        "Render",
      ],
      memory.io,
    ),
    0,
  );
  assert.equal(
    memory.stdout.join(""),
    renderRslTimelineMermaid(
      parseRslExpression(fixture),
      JSON.parse(trace) as Parameters<typeof renderRslTimelineMermaid>[1],
      "Render",
    ),
  );
});

void test("debug folds a saved trace and invalid YAML uses a nonzero code", async () => {
  const trace = JSON.stringify([
    {
      kind: "execution.started",
      sequence: 0,
      time: 0,
      expressionId: "flow",
      executionId: "execution-1",
    },
    {
      kind: "execution.finalized",
      sequence: 1,
      time: 1,
      expressionId: "flow",
      executionId: "execution-1",
      outcome: "complete",
    },
  ]);
  const memory = memoryIo({
    "trace.json": trace,
    "invalid.rsl.yaml": "Version: 0.1\n",
  });

  assert.equal(await runRslCli(["debug", "trace.json"], memory.io), 0);
  assert.match(memory.stdout.join(""), /"status": "complete"/u);
  assert.equal(await runRslCli(["validate", "invalid.rsl.yaml"], memory.io), 1);
  assert.match(memory.stderr.join(""), /invalid-scalar|invalid-schema/u);
});

void test("mutating CLI options require an unambiguous explicit mode", async () => {
  const memory = memoryIo({ "flow.rsl.yaml": fixture });

  assert.equal(
    await runRslCli(
      ["format", "flow.rsl.yaml", "--check", "--write"],
      memory.io,
    ),
    2,
  );
  assert.equal(
    await runRslCli(["visualize", "flow.rsl.yaml", "--output"], memory.io),
    2,
  );
  assert.equal(
    await runRslCli(["visualize", "flow.rsl.yaml", "--trace"], memory.io),
    2,
  );
  assert.equal(
    await runRslCli(["visualize", "flow.rsl.yaml", "--node"], memory.io),
    2,
  );
  assert.equal(memory.stored.size, 1);
});

void test("the compiled rsl executable runs as a real process", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli/entry.js", "validate", fixturePath.pathname],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^valid rsl-workflow nodes=5 edges=4$/mu);
});
