import type {
  RslExpression,
  RslMapping,
  RslValue,
  TypeRef,
} from "../model/index.js";
import { RslYamlError } from "./error.js";

const SAFE_PLAIN = /^[A-Za-z_][A-Za-z0-9_.:/-]*$/u;
const RESERVED_WORD = /^(?:true|false|null|yes|no|on|off)$/iu;
const KEY_ORDER = [
  "rsl",
  "version",
  "expression",
  "nodes",
  "edges",
  "id",
  "kind",
  "operation",
  "parameters",
  "worker",
  "scheduler",
  "category",
  "input",
  "output",
  "purity",
  "inputs",
  "outputs",
  "ref",
  "name",
  "items",
  "fields",
  "members",
  "arguments",
  "value",
  "from",
  "to",
  "node",
  "port",
  "type",
];
const KEY_RANK = new Map(KEY_ORDER.map((key, index) => [key, index]));

function compareKeys(left: string, right: string): number {
  const leftRank = KEY_RANK.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = KEY_RANK.get(right) ?? Number.MAX_SAFE_INTEGER;
  return leftRank === rightRank
    ? left < right
      ? -1
      : left > right
        ? 1
        : 0
    : leftRank - rightRank;
}

function scalar(value: null | boolean | number | string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new RslYamlError(
        "invalid-scalar",
        "Only finite numbers and safe integers can be serialized",
      );
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  const normalized = value.normalize("NFC");
  return SAFE_PLAIN.test(normalized) && !RESERVED_WORD.test(normalized)
    ? normalized
    : JSON.stringify(normalized);
}

function lines(value: RslValue, indentation: number): string[] {
  const prefix = " ".repeat(indentation);
  if (value === null || typeof value !== "object")
    return [`${prefix}${scalar(value)}`];
  if (Array.isArray(value)) {
    const items = value as readonly RslValue[];
    if (items.length === 0) return [`${prefix}[]`];
    return items.flatMap((item) => {
      const rendered = lines(item, indentation + 2);
      return [
        `${prefix}- ${rendered[0]?.slice(indentation + 2) ?? ""}`,
        ...rendered.slice(1),
      ];
    });
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareKeys(left, right),
  );
  if (entries.length === 0) return [`${prefix}{}`];
  return entries.flatMap(([key, item]) => {
    const renderedKey = scalar(key);
    if (item === null || typeof item !== "object")
      return [`${prefix}${renderedKey}: ${scalar(item)}`];
    return [`${prefix}${renderedKey}:`, ...lines(item, indentation + 2)];
  });
}

export function stringifyRslYamlValue(value: RslValue): string {
  return `${lines(value, 0).join("\n")}\n`;
}

function typeRef(type: TypeRef): RslValue {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "named") return type.ref;
  if (type.kind === "array")
    return { kind: type.kind, items: typeRef(type.items) };
  if (type.kind === "tuple")
    return { kind: type.kind, items: type.items.map(typeRef) };
  if (type.kind === "record")
    return {
      kind: type.kind,
      fields: Object.fromEntries(
        Object.entries(type.fields).map(([key, item]) => [key, typeRef(item)]),
      ),
    };
  if (type.kind === "union")
    return { kind: type.kind, members: type.members.map(typeRef) };
  if (type.kind === "generic")
    return {
      kind: type.kind,
      ref: type.ref,
      arguments: type.arguments.map(typeRef),
    };
  return { kind: type.kind, value: typeRef(type.value) };
}

function extensions(
  value: RslMapping,
  extra: RslExpression["extensions"],
): RslMapping {
  return extra === undefined ? value : { ...value, ...extra };
}

function symbolicReference(reference: {
  readonly ref: string;
  readonly version?: string;
}): RslValue {
  return reference.version === undefined
    ? reference.ref
    : { name: reference.ref, version: reference.version };
}

export function expressionToRslValue(expression: RslExpression): RslValue {
  const nodes = expression.nodes.map((node): RslValue => {
    const value: Record<string, RslValue> = {
      id: node.id,
      kind: node.kind,
      operation: symbolicReference(node.operation),
    };
    if (node.parameters !== undefined) value.parameters = node.parameters;
    if (node.worker !== undefined) {
      if (
        node.worker.contract !== undefined &&
        node.worker.contract.inputs.length !== 1
      ) {
        throw new RslYamlError(
          "invalid-schema",
          "RSL YAML v0.1 Worker contracts require exactly one input TypeRef",
        );
      }
      value.worker = {
        ref: node.worker.worker.ref,
        ...(node.worker.worker.version === undefined
          ? {}
          : { version: node.worker.worker.version }),
        ...(node.worker.input === undefined
          ? {}
          : { input: typeRef(node.worker.input) }),
        ...(node.worker.output === undefined
          ? {}
          : { output: typeRef(node.worker.output) }),
        ...(node.worker.contract === undefined
          ? {}
          : {
              category: node.worker.contract.category,
              input: typeRef(node.worker.contract.inputs[0]),
              output: typeRef(node.worker.contract.output),
              purity: node.worker.contract.purity,
            }),
      };
    }
    if (node.scheduler !== undefined)
      value.scheduler = {
        ref: node.scheduler.scheduler.ref,
        ...(node.scheduler.scheduler.version === undefined
          ? {}
          : { version: node.scheduler.scheduler.version }),
      };
    if (node.inputs.length > 0)
      value.inputs = node.inputs.map((port) => ({
        id: port.id,
        type: typeRef(port.type),
      }));
    if (node.outputs.length > 0)
      value.outputs = node.outputs.map((port) => ({
        id: port.id,
        type: typeRef(port.type),
      }));
    return extensions(value, node.extensions);
  });
  const edges = expression.edges.map((edge) => ({
    from: { node: edge.from.node, port: edge.from.port },
    to: { node: edge.to.node, port: edge.to.port },
  }));
  const root = extensions(
    { version: expression.version, expression: expression.id, nodes, edges },
    expression.extensions,
  );
  return { rsl: root };
}

export function stringifyRslExpression(expression: RslExpression): string {
  return stringifyRslYamlValue(expressionToRslValue(expression));
}
