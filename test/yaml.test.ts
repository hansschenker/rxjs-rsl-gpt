import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRslExpression,
  parseRslYamlValue,
  RslYamlError,
  stringifyRslExpression,
  stringifyRslYamlValue,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../conformance/fixtures/valid/double-and-filter.rsl.yaml",
  import.meta.url,
);

void test("normalizes deterministic YAML into the RSL 06 model", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const expression = parseRslExpression(source);

  assert.equal(expression.id, "double-and-filter-numbers");
  assert.equal(expression.nodes[0].kind, "source");
  assert.deepEqual(expression.nodes[0].inputs, []);
  assert.deepEqual(expression.nodes[0].outputs[0].type, {
    kind: "primitive",
    name: "number",
  });
  const firstEdge = expression.edges[0];
  assert.ok(firstEdge);
  assert.deepEqual(firstEdge.from, {
    direction: "output",
    node: "numbers",
    port: "value",
  });
});

void test("canonical serialization is stable and round-trips", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  const first = stringifyRslExpression(parseRslExpression(source));
  const second = stringifyRslExpression(parseRslExpression(first));

  assert.equal(second, first);
  assert.ok(first.endsWith("\n"));
  assert.ok(!first.includes("[1, 2, 3]"));
  assert.ok(!first.includes("#"));
});

void test("mapping order and comments do not affect canonical values", () => {
  const left = parseRslYamlValue("# comment\nb: 2\na: 1\n");
  const right = parseRslYamlValue("a: 1\nb: 2\n");
  assert.equal(stringifyRslYamlValue(left), stringifyRslYamlValue(right));
});

const forbidden: ReadonlyArray<readonly [string, string]> = [
  ["document markers", "---\na: 1\n"],
  ["duplicate keys", "a: 1\na: 2\n"],
  ["anchors", "a: &value 1\n"],
  ["aliases", "a: *value\n"],
  ["tags", "a: !!str value\n"],
  ["merge keys", "a:\n  <<: value\n"],
  ["single quotes", "a: 'value'\n"],
  ["block strings", "a: |\n  value\n"],
  ["legacy booleans", "a: yes\n"],
  ["implicit dates", "a: 2026-09-04\n"],
  ["leading-zero integers", "a: 01\n"],
  ["non-finite numbers", "a: .nan\n"],
  ["empty values", "a:\n"],
  ["flow mappings", "a: { b: 1 }\n"],
  ["trailing sequence commas", "a: [1, 2,]\n"],
  ["missing final newline", "a: 1"],
];

for (const [name, source] of forbidden) {
  void test(`rejects ${name}`, () => {
    assert.throws(() => parseRslYamlValue(source), RslYamlError);
  });
}

void test("parsing cannot execute embedded JavaScript", () => {
  let invoked = false;
  Object.defineProperty(globalThis, "rslProbe", {
    configurable: true,
    get() {
      invoked = true;
      return "executed";
    },
  });
  try {
    const parsed = parseRslYamlValue('worker: "globalThis.rslProbe"\n');
    assert.deepEqual(parsed, { worker: "globalThis.rslProbe" });
    assert.equal(invoked, false);
  } finally {
    Reflect.deleteProperty(globalThis, "rslProbe");
  }
});
