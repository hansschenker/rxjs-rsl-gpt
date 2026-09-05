import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseRslExpression,
  renderRslMermaid,
  renderRslTimelineMermaid,
  type RslTraceEvent,
  validateRslStructure,
} from "../src/index.js";

const exampleDirectory = new URL(
  "../examples/temperature-alerts/",
  import.meta.url,
);
const source = readFileSync(
  new URL("workflow.rsl.yaml", exampleDirectory),
  "utf8",
);
const expectedDiagram = readFileSync(
  new URL("workflow.mmd", exampleDirectory),
  "utf8",
);

void test("temperature example diagram is generated from its valid RSL graph", () => {
  const expression = parseRslExpression(source);
  assert.equal(validateRslStructure(expression).valid, true);
  assert.equal(renderRslMermaid(expression), expectedDiagram);
});

void test("double-and-filter diagram is generated from its valid RSL graph", () => {
  const directory = new URL("../examples/double-and-filter/", import.meta.url);
  const expression = parseRslExpression(
    readFileSync(new URL("workflow.rsl.yaml", directory), "utf8"),
  );
  const diagram = readFileSync(new URL("workflow.mmd", directory), "utf8");
  const trace = JSON.parse(
    readFileSync(new URL("trace.json", directory), "utf8"),
  ) as RslTraceEvent[];
  const timeline = readFileSync(
    new URL("execution-timeline.mmd", directory),
    "utf8",
  );

  assert.equal(validateRslStructure(expression).valid, true);
  assert.equal(
    expression.nodes.find((node) => node.id === "Double")?.extensions?.[
      "x-jsonata"
    ],
    "{% $ * 2 %}",
  );
  assert.equal(renderRslMermaid(expression), diagram);
  assert.equal(
    renderRslTimelineMermaid(expression, trace, "Console"),
    timeline,
  );
});

void test("temperature example compiles and matches the equivalent RxJS output", () => {
  const run = (file: string) =>
    spawnSync(process.execPath, ["--import", "tsx", file], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
  const compiled = run("examples/temperature-alerts/run.ts");
  const equivalent = run("examples/temperature-alerts/equivalent-rxjs.ts");

  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(equivalent.status, 0, equivalent.stderr);
  assert.equal(
    compiled.stdout,
    `RSL compiled to a cold RxJS Observable; subscribing now.
${equivalent.stdout}`,
  );
});
