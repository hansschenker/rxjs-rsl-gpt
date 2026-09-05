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
  "Version",
  "Comment",
  "StartAt",
  "Nodes",
  "Type",
  "Operation",
  "Worker",
  "Arguments",
  "Scheduler",
  "SubscribeOn",
  "ObserveOn",
  "Input",
  "Inputs",
  "From",
  "InnerSource",
  "CreatedBy",
  "Concurrency",
  "Policy",
  "Limit",
  "Output",
  "Next",
  "Error",
  "Complete",
  "Handlers",
  "End",
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

function expressionToLegacyRslValue(expression: RslExpression): RslValue {
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
    const legacyScheduler =
      node.scheduler?.operation ?? node.scheduler?.scheduler;
    if (legacyScheduler !== undefined)
      value.scheduler = {
        ref: legacyScheduler.ref,
        ...(legacyScheduler.version === undefined
          ? {}
          : { version: legacyScheduler.version }),
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

function specReference(reference: {
  readonly ref: string;
  readonly version?: string;
}): string {
  if (reference.version !== undefined)
    throw new RslYamlError(
      "invalid-schema",
      "ASL-inspired RSL v0.1 does not serialize versioned references",
    );
  return reference.ref;
}

function specPort(port: {
  readonly type: TypeRef;
  readonly errorType?: TypeRef;
  readonly complete?: boolean;
}): RslValue {
  const defaultError =
    port.errorType === undefined ||
    (port.errorType.kind === "primitive" && port.errorType.name === "unknown");
  const defaultComplete = port.complete === undefined || port.complete;
  if (defaultError && defaultComplete) return { Type: typeRef(port.type) };
  return {
    Next: { Type: typeRef(port.type) },
    Error: {
      Type: typeRef(port.errorType ?? { kind: "primitive", name: "unknown" }),
    },
    Complete: port.complete ?? true,
  };
}

function upperFirst(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function specArguments(
  operation: string,
  parameters: RslMapping | undefined,
): RslValue | undefined {
  if (parameters === undefined) return undefined;
  if (operation === "rxjs.from") return [parameters.values ?? []];
  if (operation === "rxjs.of")
    return Array.isArray(parameters.values)
      ? (parameters.values as readonly RslValue[])
      : parameters.values === undefined
        ? []
        : [parameters.values];
  if (Array.isArray(parameters.arguments))
    return parameters.arguments as readonly RslValue[];
  const entries = Object.entries(parameters).filter(
    ([key]) => key !== "concurrency",
  );
  return entries.length === 0
    ? undefined
    : Object.fromEntries(entries.map(([key, item]) => [upperFirst(key), item]));
}

function specScheduler(
  binding: RslExpression["nodes"][number]["scheduler"],
): RslValue | undefined {
  if (binding === undefined) return undefined;
  const operation = binding.operation ?? binding.scheduler;
  if (
    operation !== undefined &&
    binding.subscribeOn === undefined &&
    binding.observeOn === undefined
  )
    return specReference(operation);
  return {
    ...(operation === undefined ? {} : { Operation: specReference(operation) }),
    ...(binding.subscribeOn === undefined
      ? {}
      : { SubscribeOn: specReference(binding.subscribeOn) }),
    ...(binding.observeOn === undefined
      ? {}
      : { ObserveOn: specReference(binding.observeOn) }),
  };
}

/** Canonical ASL-inspired RSL v0.1 concrete syntax. */
export function expressionToRslValue(expression: RslExpression): RslValue {
  const incoming = new Map<string, RslExpression["edges"][number]>();
  const outgoing = new Map<string, RslExpression["edges"]>();
  for (const edge of expression.edges) {
    incoming.set(`${edge.to.node}\u0000${edge.to.port}`, edge);
    outgoing.set(edge.from.node, [
      ...(outgoing.get(edge.from.node) ?? []),
      edge,
    ]);
  }

  const Nodes: Record<string, RslValue> = {};
  for (const node of expression.nodes) {
    const nextEdges = outgoing.get(node.id) ?? [];
    if (node.kind !== "sink" && nextEdges.length !== 1)
      return expressionToLegacyRslValue(expression);
    if (node.extensions !== undefined)
      return expressionToLegacyRslValue(expression);

    if (node.kind === "source") {
      if (node.outputs.length !== 1)
        return expressionToLegacyRslValue(expression);
      const Arguments = specArguments(node.operation.ref, node.parameters);
      const Scheduler = specScheduler(node.scheduler);
      Nodes[node.id] = {
        Type: "Source",
        Operation: specReference(node.operation),
        ...(Arguments === undefined ? {} : { Arguments }),
        ...(Scheduler === undefined ? {} : { Scheduler }),
        Output: specPort(node.outputs[0]),
        Next: nextEdges[0]?.to.node ?? "",
      };
      continue;
    }

    if (node.kind === "pipeline") {
      if (node.outputs.length !== 1)
        return expressionToLegacyRslValue(expression);
      const Arguments = specArguments(node.operation.ref, node.parameters);
      const Scheduler = specScheduler(node.scheduler);
      const inputValue: Record<string, RslValue> = {};
      if (node.inputs.length === 1) inputValue.Input = specPort(node.inputs[0]);
      else
        inputValue.Inputs = node.inputs.map((port) => {
          const edge = incoming.get(`${node.id}\u0000${port.id}`);
          if (edge === undefined)
            throw new RslYamlError(
              "invalid-schema",
              `Input is not connected: ${node.id}.${port.id}`,
            );
          return {
            From: edge.from.node,
            ...(specPort(port) as RslMapping),
          };
        });
      Nodes[node.id] = {
        Type: "Pipeline",
        Operation: specReference(node.operation),
        ...(node.worker === undefined
          ? {}
          : { Worker: specReference(node.worker.worker) }),
        ...(Arguments === undefined ? {} : { Arguments }),
        ...(Scheduler === undefined ? {} : { Scheduler }),
        ...inputValue,
        ...(node.innerSource === undefined
          ? {}
          : {
              InnerSource: {
                CreatedBy: "Worker",
                Output: { Type: typeRef(node.innerSource.output) },
              },
            }),
        ...(node.concurrency === undefined
          ? {}
          : {
              Concurrency: {
                Policy: upperFirst(node.concurrency.policy),
                Limit:
                  node.concurrency.limit === "unbounded"
                    ? "Unbounded"
                    : node.concurrency.limit,
              },
            }),
        Output: specPort(node.outputs[0]),
        Next: nextEdges[0]?.to.node ?? "",
      };
      continue;
    }

    if (node.inputs.length !== 1 || nextEdges.length !== 0)
      return expressionToLegacyRslValue(expression);
    const handlers = node.handlers;
    const Scheduler = specScheduler(node.scheduler);
    const nextHandler = handlers?.next ?? node.worker;
    Nodes[node.id] = {
      Type: "Sink",
      Input: specPort(node.inputs[0]),
      ...(Scheduler === undefined ? {} : { Scheduler }),
      ...(handlers === undefined && nextHandler === undefined
        ? {}
        : {
            Handlers: {
              ...(nextHandler === undefined
                ? {}
                : { Next: specReference(nextHandler.worker) }),
              ...(handlers?.error === undefined
                ? {}
                : { Error: specReference(handlers.error.worker) }),
              ...(handlers?.complete === undefined
                ? {}
                : { Complete: specReference(handlers.complete.worker) }),
            },
          }),
      End: true,
    };
  }

  const sources = expression.nodes
    .filter((node) => node.kind === "source")
    .map((node) => node.id);
  const startAt = expression.startAt ?? (sources as [string, ...string[]]);
  return {
    Version: expression.version,
    StartAt: startAt.length === 1 ? startAt[0] : startAt,
    Nodes,
  };
}

export function stringifyRslExpression(expression: RslExpression): string {
  return stringifyRslYamlValue(expressionToRslValue(expression));
}
