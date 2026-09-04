import type {
  Edge,
  Extensions,
  InputPort,
  OperationRef,
  OutputPort,
  PipelineNode,
  PortTypeRef,
  PrimitiveTypeName,
  RslExpression,
  RslMapping,
  RslNode,
  RslValue,
  SinkNode,
  SourceNode,
  TypeRef,
  WorkerBinding,
  WorkerCategory,
  WorkerPurity,
} from "../model/index.js";
import { RslYamlError } from "./error.js";

const PRIMITIVES = new Set([
  "string",
  "number",
  "boolean",
  "null",
  "unknown",
  "never",
  "void",
]);
const WORKER_CATEGORIES = new Set<WorkerCategory>([
  "transformation",
  "predicate",
  "reducer",
  "projection",
  "observable-producing",
  "effect",
]);
const WORKER_PURITY = new Set<WorkerPurity>(["pure", "effectful"]);

function fail(message: string): never {
  throw new RslYamlError("invalid-schema", message);
}

function mapping(value: RslValue, path: string): RslMapping {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    fail(`${path} must be a mapping`);
  return value as RslMapping;
}

function sequence(
  value: RslValue | undefined,
  path: string,
): readonly RslValue[] {
  if (!Array.isArray(value)) fail(`${path} must be a sequence`);
  return value as readonly RslValue[];
}

function string(value: RslValue | undefined, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(`${path} must be a non-empty string`);
  return value;
}

function fields(
  value: RslMapping,
  allowed: readonly string[],
  path: string,
): Extensions | undefined {
  const extensions: Record<`x-${string}`, RslValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("x-")) extensions[key as `x-${string}`] = item;
    else if (!allowed.includes(key))
      fail(`${path}.${key} is not defined by RSL v0.1`);
  }
  return Object.keys(extensions).length === 0 ? undefined : extensions;
}

function reference(
  value: RslValue | undefined,
  kind: OperationRef["kind"],
  path: string,
): OperationRef {
  if (typeof value === "string") return { kind, ref: string(value, path) };
  const record = mapping(value as RslValue, path);
  fields(record, ["ref", "name", "version"], path);
  const ref = string(record.ref ?? record.name, `${path}.ref`);
  const version =
    record.version === undefined
      ? undefined
      : string(record.version, `${path}.version`);
  return version === undefined ? { kind, ref } : { kind, ref, version };
}

export function normalizeTypeRef(value: RslValue, path = "type"): TypeRef {
  if (typeof value === "string") {
    return PRIMITIVES.has(value)
      ? { kind: "primitive", name: value as PrimitiveTypeName }
      : { kind: "named", ref: value };
  }
  const record = mapping(value, path);
  const kind = string(record.kind, `${path}.kind`);
  if (kind === "array") {
    fields(record, ["kind", "items"], path);
    return {
      kind,
      items: normalizeTypeRef(record.items as RslValue, `${path}.items`),
    };
  }
  if (kind === "tuple") {
    fields(record, ["kind", "items"], path);
    return {
      kind,
      items: sequence(record.items, `${path}.items`).map((item, index) =>
        normalizeTypeRef(item, `${path}.items[${String(index)}]`),
      ),
    };
  }
  if (kind === "record") {
    fields(record, ["kind", "fields"], path);
    const declared = mapping(record.fields as RslValue, `${path}.fields`);
    return {
      kind,
      fields: Object.fromEntries(
        Object.entries(declared).map(([key, item]) => [
          key,
          normalizeTypeRef(item, `${path}.fields.${key}`),
        ]),
      ),
    };
  }
  if (kind === "union") {
    fields(record, ["kind", "members"], path);
    const members = sequence(record.members, `${path}.members`).map(
      (item, index) =>
        normalizeTypeRef(item, `${path}.members[${String(index)}]`),
    );
    if (members.length === 0) fail(`${path}.members must not be empty`);
    return { kind, members: members as [TypeRef, ...TypeRef[]] };
  }
  if (kind === "generic") {
    fields(record, ["kind", "ref", "arguments"], path);
    return {
      kind,
      ref: string(record.ref, `${path}.ref`),
      arguments: sequence(record.arguments, `${path}.arguments`).map(
        (item, index) =>
          normalizeTypeRef(item, `${path}.arguments[${String(index)}]`),
      ),
    };
  }
  if (kind === "observable") {
    fields(record, ["kind", "value"], path);
    return {
      kind,
      value: normalizeTypeRef(record.value as RslValue, `${path}.value`),
    };
  }
  return fail(`${path}.kind has unsupported TypeRef kind ${kind}`);
}

function port(
  value: RslValue,
  direction: "input" | "output",
  path: string,
): InputPort | OutputPort {
  const record = mapping(value, path);
  fields(record, ["id", "type"], path);
  const type = normalizeTypeRef(record.type as RslValue, `${path}.type`);
  if (
    type.kind === "observable" ||
    (type.kind === "primitive" && type.name === "void")
  )
    fail(
      `${path}.type cannot carry ${type.kind === "observable" ? "an Observable" : "void"}`,
    );
  return {
    direction,
    id: string(record.id, `${path}.id`),
    type: type as PortTypeRef,
  };
}

function ports(
  value: RslValue | undefined,
  direction: "input" | "output",
  path: string,
): readonly (InputPort | OutputPort)[] {
  return sequence(value, path).map((item, index) =>
    port(item, direction, `${path}[${String(index)}]`),
  );
}

function worker(value: RslValue, path: string): WorkerBinding {
  const record = mapping(value, path);
  fields(
    record,
    ["ref", "version", "input", "output", "category", "purity", "contract"],
    path,
  );
  const version =
    record.version === undefined
      ? undefined
      : string(record.version, `${path}.version`);
  const result: WorkerBinding = {
    worker: {
      kind: "worker",
      ref: string(record.ref, `${path}.ref`),
      ...(version === undefined ? {} : { version }),
    },
  };
  const input =
    record.input === undefined
      ? undefined
      : normalizeTypeRef(record.input, `${path}.input`);
  const output =
    record.output === undefined
      ? undefined
      : normalizeTypeRef(record.output, `${path}.output`);
  if (record.contract !== undefined)
    fail(`${path}.contract is reserved for a later concrete syntax revision`);
  if (record.category !== undefined || record.purity !== undefined) {
    if (input === undefined || output === undefined)
      fail(`${path} requires input and output with category or purity`);
    const category = string(
      record.category,
      `${path}.category`,
    ) as WorkerCategory;
    const purity = string(record.purity, `${path}.purity`) as WorkerPurity;
    if (!WORKER_CATEGORIES.has(category)) fail(`${path}.category is invalid`);
    if (!WORKER_PURITY.has(purity)) fail(`${path}.purity is invalid`);
    return {
      ...result,
      contract: { category, inputs: [input], output, purity },
    };
  }
  return {
    ...result,
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

function node(value: RslValue, index: number): RslNode {
  const path = `rsl.nodes[${String(index)}]`;
  const record = mapping(value, path);
  const extensions = fields(
    record,
    [
      "id",
      "kind",
      "operation",
      "parameters",
      "worker",
      "scheduler",
      "inputs",
      "outputs",
    ],
    path,
  );
  const kind = string(record.kind, `${path}.kind`);
  const common = {
    id: string(record.id, `${path}.id`),
    operation: reference(record.operation, "operation", `${path}.operation`),
    ...(record.parameters === undefined
      ? {}
      : { parameters: mapping(record.parameters, `${path}.parameters`) }),
    ...(record.worker === undefined
      ? {}
      : { worker: worker(record.worker, `${path}.worker`) }),
    ...(record.scheduler === undefined
      ? {}
      : {
          scheduler: {
            scheduler: {
              ...reference(record.scheduler, "operation", `${path}.scheduler`),
              kind: "scheduler" as const,
            },
          },
        }),
    ...(extensions === undefined ? {} : { extensions }),
  };
  if (kind === "source") {
    if (record.inputs !== undefined)
      fail(`${path}.inputs is forbidden for a Source`);
    const outputs = ports(
      record.outputs,
      "output",
      `${path}.outputs`,
    ) as OutputPort[];
    if (outputs.length === 0) fail(`${path}.outputs must not be empty`);
    return {
      ...common,
      kind,
      inputs: [],
      outputs: outputs as [OutputPort, ...OutputPort[]],
    } satisfies SourceNode;
  }
  if (kind === "pipeline") {
    const inputs = ports(
      record.inputs,
      "input",
      `${path}.inputs`,
    ) as InputPort[];
    const outputs = ports(
      record.outputs,
      "output",
      `${path}.outputs`,
    ) as OutputPort[];
    if (inputs.length === 0 || outputs.length === 0)
      fail(`${path} requires non-empty inputs and outputs`);
    return {
      ...common,
      kind,
      inputs: inputs as [InputPort, ...InputPort[]],
      outputs: outputs as [OutputPort, ...OutputPort[]],
    } satisfies PipelineNode;
  }
  if (kind === "sink") {
    if (record.outputs !== undefined)
      fail(`${path}.outputs is forbidden for a Sink`);
    const inputs = ports(
      record.inputs,
      "input",
      `${path}.inputs`,
    ) as InputPort[];
    if (inputs.length === 0) fail(`${path}.inputs must not be empty`);
    return {
      ...common,
      kind,
      inputs: inputs as [InputPort, ...InputPort[]],
      outputs: [],
    } satisfies SinkNode;
  }
  return fail(`${path}.kind must be source, pipeline, or sink`);
}

function edge(value: RslValue, index: number): Edge {
  const path = `rsl.edges[${String(index)}]`;
  const record = mapping(value, path);
  fields(record, ["from", "to"], path);
  const from = mapping(record.from as RslValue, `${path}.from`);
  const to = mapping(record.to as RslValue, `${path}.to`);
  fields(from, ["node", "port"], `${path}.from`);
  fields(to, ["node", "port"], `${path}.to`);
  return {
    from: {
      direction: "output",
      node: string(from.node, `${path}.from.node`),
      port: string(from.port, `${path}.from.port`),
    },
    to: {
      direction: "input",
      node: string(to.node, `${path}.to.node`),
      port: string(to.port, `${path}.to.port`),
    },
  };
}

export function normalizeRslDocument(value: RslValue): RslExpression {
  const document = mapping(value, "document");
  fields(document, ["rsl"], "document");
  const root = mapping(document.rsl as RslValue, "rsl");
  const extensions = fields(
    root,
    ["version", "expression", "nodes", "edges"],
    "rsl",
  );
  if (root.version !== "0.1") fail('rsl.version must be the string "0.1"');
  const nodes = sequence(root.nodes, "rsl.nodes").map(node);
  if (nodes.length === 0) fail("rsl.nodes must not be empty");
  return {
    kind: "rsl-expression",
    version: "0.1",
    id: string(root.expression, "rsl.expression"),
    nodes: nodes as [RslNode, ...RslNode[]],
    edges: sequence(root.edges, "rsl.edges").map(edge),
    ...(extensions === undefined ? {} : { extensions }),
  };
}
