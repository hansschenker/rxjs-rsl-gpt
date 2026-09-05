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
  SchedulerBinding,
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
    const tuple = /^readonly \[(.*)\]$/u.exec(value);
    if (tuple !== null) {
      const body = tuple[1]?.trim() ?? "";
      return {
        kind: "tuple",
        items:
          body === ""
            ? []
            : body
                .split(",")
                .map((item, index) =>
                  normalizeTypeRef(
                    item.trim(),
                    `${path}.items[${String(index)}]`,
                  ),
                ),
      };
    }
    const array = /^readonly (.+)\[\]$/u.exec(value);
    if (array?.[1] !== undefined)
      return {
        kind: "array",
        items: normalizeTypeRef(array[1].trim(), `${path}.items`),
      };
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

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function specPort(
  value: RslValue,
  direction: "input" | "output",
  id: string,
  path: string,
): InputPort | OutputPort {
  const record = mapping(value, path);
  fields(record, ["Type", "Next", "Error", "Complete"], path);
  const next =
    record.Type === undefined
      ? mapping(record.Next as RslValue, `${path}.Next`).Type
      : record.Type;
  if (next === undefined) fail(`${path} requires Type or Next.Type`);
  const type = normalizeTypeRef(next, `${path}.Next.Type`);
  if (
    type.kind === "observable" ||
    (type.kind === "primitive" && type.name === "void")
  )
    fail(`${path} cannot carry Observable or void next-values`);
  const errorType =
    record.Error === undefined
      ? normalizeTypeRef("unknown", `${path}.Error.Type`)
      : normalizeTypeRef(
          mapping(record.Error, `${path}.Error`).Type as RslValue,
          `${path}.Error.Type`,
        );
  if (record.Complete !== undefined && typeof record.Complete !== "boolean")
    fail(`${path}.Complete must be boolean`);
  return {
    direction,
    id,
    type: type as PortTypeRef,
    errorType,
    complete: record.Complete === undefined ? true : record.Complete,
  };
}

function specWorker(
  value: RslValue | undefined,
  path: string,
  input?: TypeRef,
  output?: TypeRef,
): WorkerBinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string")
    return {
      worker: { kind: "worker", ref: value },
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
    };
  return worker(value, path);
}

function schedulerRef(value: RslValue, path: string) {
  return { ...reference(value, "operation", path), kind: "scheduler" as const };
}

function specScheduler(
  value: RslValue | undefined,
  path: string,
): SchedulerBinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string")
    return { operation: schedulerRef(value, path) };
  const record = mapping(value, path);
  fields(record, ["Operation", "SubscribeOn", "ObserveOn"], path);
  if (
    record.Operation === undefined &&
    record.SubscribeOn === undefined &&
    record.ObserveOn === undefined
  )
    fail(`${path} must declare Operation, SubscribeOn, or ObserveOn`);
  return {
    ...(record.Operation === undefined
      ? {}
      : { operation: schedulerRef(record.Operation, `${path}.Operation`) }),
    ...(record.SubscribeOn === undefined
      ? {}
      : {
          subscribeOn: schedulerRef(record.SubscribeOn, `${path}.SubscribeOn`),
        }),
    ...(record.ObserveOn === undefined
      ? {}
      : {
          observeOn: schedulerRef(record.ObserveOn, `${path}.ObserveOn`),
        }),
  };
}

function specParameters(
  operation: string,
  argumentsValue: RslValue | undefined,
): RslMapping | undefined {
  if (argumentsValue === undefined) return undefined;
  if (Array.isArray(argumentsValue)) {
    const argumentsList = argumentsValue as readonly RslValue[];
    if (operation === "rxjs.from") return { values: argumentsList[0] ?? [] };
    if (operation === "rxjs.of") return { values: argumentsList };
    return { arguments: argumentsList };
  }
  const declared = mapping(argumentsValue, "Arguments");
  return Object.fromEntries(
    Object.entries(declared).map(([key, item]) => [lowerFirst(key), item]),
  );
}

function normalizeAslInspiredDocument(document: RslMapping): RslExpression {
  fields(document, ["Version", "Comment", "StartAt", "Nodes"], "document");
  if (document.Version !== "0.1") fail('Version must be the string "0.1"');
  const entries = Array.isArray(document.StartAt)
    ? (document.StartAt as readonly RslValue[]).map((item, index) =>
        string(item, `StartAt[${String(index)}]`),
      )
    : [string(document.StartAt, "StartAt")];
  if (entries.length === 0) fail("StartAt must not be empty");
  const declared = mapping(document.Nodes as RslValue, "Nodes");
  const nextByNode = new Map<string, string>();
  const fromByNode = new Map<string, readonly string[]>();

  const nodes = Object.entries(declared).map(([id, item]): RslNode => {
    const path = `Nodes.${id}`;
    const record = mapping(item, path);
    const type = string(record.Type, `${path}.Type`);
    const next =
      record.Next === undefined
        ? undefined
        : string(record.Next, `${path}.Next`);
    if (next !== undefined) nextByNode.set(id, next);

    if (type === "Source") {
      fields(
        record,
        ["Type", "Operation", "Arguments", "Scheduler", "Output", "Next"],
        path,
      );
      if (next === undefined) fail(`${path}.Next is required`);
      const operation = string(record.Operation, `${path}.Operation`);
      const output = specPort(
        record.Output as RslValue,
        "output",
        "value",
        `${path}.Output`,
      ) as OutputPort;
      const parameters = specParameters(operation, record.Arguments);
      const scheduler = specScheduler(record.Scheduler, `${path}.Scheduler`);
      return {
        kind: "source",
        id,
        operation: { kind: "operation", ref: operation },
        ...(parameters === undefined ? {} : { parameters }),
        ...(scheduler === undefined ? {} : { scheduler }),
        inputs: [],
        outputs: [output],
      };
    }

    if (type === "Pipeline") {
      fields(
        record,
        [
          "Type",
          "Operation",
          "Worker",
          "Arguments",
          "Scheduler",
          "Input",
          "Inputs",
          "InnerSource",
          "Concurrency",
          "Output",
          "Next",
        ],
        path,
      );
      if (next === undefined) fail(`${path}.Next is required`);
      const operation = string(record.Operation, `${path}.Operation`);
      const inputs: InputPort[] = [];
      if (record.Input !== undefined) {
        if (record.Inputs !== undefined)
          fail(`${path} cannot declare both Input and Inputs`);
        inputs.push(
          specPort(
            record.Input,
            "input",
            "value",
            `${path}.Input`,
          ) as InputPort,
        );
      } else {
        const bindings = sequence(record.Inputs, `${path}.Inputs`);
        if (bindings.length < 2)
          fail(`${path}.Inputs requires at least two bindings`);
        const from: string[] = [];
        bindings.forEach((binding, index) => {
          const bindingPath = `${path}.Inputs[${String(index)}]`;
          const value = mapping(binding, bindingPath);
          fields(
            value,
            ["From", "Type", "Next", "Error", "Complete"],
            bindingPath,
          );
          from.push(string(value.From, `${bindingPath}.From`));
          const portValue = Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "From"),
          );
          inputs.push(
            specPort(
              portValue,
              "input",
              `input-${String(index)}`,
              bindingPath,
            ) as InputPort,
          );
        });
        fromByNode.set(id, from);
      }
      if (inputs.length === 0) fail(`${path} requires Input or Inputs`);
      const output = specPort(
        record.Output as RslValue,
        "output",
        "value",
        `${path}.Output`,
      ) as OutputPort;
      const parameters = specParameters(operation, record.Arguments);
      const scheduler = specScheduler(record.Scheduler, `${path}.Scheduler`);
      let workerBinding = specWorker(
        record.Worker,
        `${path}.Worker`,
        inputs[0]?.type,
        output.type,
      );
      let innerSource: PipelineNode["innerSource"];
      if (record.InnerSource !== undefined) {
        const inner = mapping(record.InnerSource, `${path}.InnerSource`);
        fields(inner, ["CreatedBy", "Output"], `${path}.InnerSource`);
        if (inner.CreatedBy !== undefined && inner.CreatedBy !== "Worker")
          fail(`${path}.InnerSource.CreatedBy must be Worker`);
        const innerOutput = specPort(
          inner.Output as RslValue,
          "output",
          "value",
          `${path}.InnerSource.Output`,
        );
        innerSource = { createdBy: "worker", output: innerOutput.type };
      }
      let concurrency: PipelineNode["concurrency"];
      if (record.Concurrency !== undefined) {
        const value = mapping(record.Concurrency, `${path}.Concurrency`);
        fields(value, ["Policy", "Limit"], `${path}.Concurrency`);
        const policyNames: Readonly<
          Record<string, "concurrent" | "queue" | "latest" | "first">
        > = {
          Concurrent: "concurrent",
          Queue: "queue",
          Latest: "latest",
          First: "first",
        } as const;
        const declaredPolicy = string(
          value.Policy,
          `${path}.Concurrency.Policy`,
        );
        const policy = policyNames[declaredPolicy];
        if (policy === undefined) fail(`${path}.Concurrency.Policy is invalid`);
        const limit =
          value.Limit === "Unbounded"
            ? "unbounded"
            : typeof value.Limit === "number" &&
                Number.isSafeInteger(value.Limit) &&
                value.Limit > 0
              ? value.Limit
              : fail(
                  `${path}.Concurrency.Limit must be a positive integer or Unbounded`,
                );
        concurrency = { policy, limit };
      }
      const defaults: Readonly<
        Record<
          string,
          {
            readonly policy: "concurrent" | "queue" | "latest" | "first";
            readonly limit: number | "unbounded";
          }
        >
      > = {
        "rxjs.mergeMap": { policy: "concurrent", limit: "unbounded" },
        "rxjs.concatMap": { policy: "queue", limit: 1 },
        "rxjs.switchMap": { policy: "latest", limit: 1 },
        "rxjs.exhaustMap": { policy: "first", limit: 1 },
      } as const;
      const expected = defaults[operation];
      if (innerSource !== undefined && expected === undefined)
        fail(`${path}.InnerSource requires a flattening operation`);
      if (expected !== undefined) {
        if (workerBinding === undefined)
          fail(`${path}.Worker is required for ${operation}`);
        if (innerSource === undefined)
          fail(`${path}.InnerSource is required for ${operation}`);
        workerBinding = {
          ...workerBinding,
          output: { kind: "observable", value: innerSource.output },
        };
        concurrency ??= expected;
        if (concurrency.policy !== expected.policy)
          fail(`${path}.Concurrency.Policy does not match ${operation}`);
      }
      const effectiveParameters =
        operation === "rxjs.mergeMap" && concurrency !== undefined
          ? {
              ...(parameters ?? {}),
              ...(concurrency.limit === "unbounded"
                ? {}
                : { concurrency: concurrency.limit }),
            }
          : parameters;
      return {
        kind: "pipeline",
        id,
        operation: { kind: "operation", ref: operation },
        ...(effectiveParameters === undefined
          ? {}
          : { parameters: effectiveParameters }),
        ...(scheduler === undefined ? {} : { scheduler }),
        ...(workerBinding === undefined ? {} : { worker: workerBinding }),
        inputs: inputs as [InputPort, ...InputPort[]],
        outputs: [output],
        ...(innerSource === undefined ? {} : { innerSource }),
        ...(concurrency === undefined ? {} : { concurrency }),
      };
    }

    if (type === "Sink") {
      fields(record, ["Type", "Input", "Scheduler", "Handlers", "End"], path);
      if (record.End !== true) fail(`${path}.End must be true`);
      if (next !== undefined) fail(`${path}.Next is forbidden for a Sink`);
      const input = specPort(
        record.Input as RslValue,
        "input",
        "value",
        `${path}.Input`,
      ) as InputPort;
      const declaredHandlers =
        record.Handlers === undefined
          ? undefined
          : mapping(record.Handlers, `${path}.Handlers`);
      if (declaredHandlers !== undefined)
        fields(
          declaredHandlers,
          ["Next", "Error", "Complete"],
          `${path}.Handlers`,
        );
      const voidType = normalizeTypeRef("void");
      const scheduler = specScheduler(record.Scheduler, `${path}.Scheduler`);
      const handlers =
        declaredHandlers === undefined
          ? undefined
          : {
              next: specWorker(
                declaredHandlers.Next,
                `${path}.Handlers.Next`,
                input.type,
                voidType,
              ),
              error: specWorker(
                declaredHandlers.Error,
                `${path}.Handlers.Error`,
                input.errorType,
                voidType,
              ),
              complete: specWorker(
                declaredHandlers.Complete,
                `${path}.Handlers.Complete`,
                voidType,
                voidType,
              ),
            };
      return {
        kind: "sink",
        id,
        operation: { kind: "operation", ref: "rsl.handlers" },
        inputs: [input],
        outputs: [],
        ...(scheduler === undefined ? {} : { scheduler }),
        ...(handlers === undefined
          ? {}
          : {
              handlers: {
                ...(handlers.next === undefined ? {} : { next: handlers.next }),
                ...(handlers.error === undefined
                  ? {}
                  : { error: handlers.error }),
                ...(handlers.complete === undefined
                  ? {}
                  : { complete: handlers.complete }),
              },
            }),
      };
    }
    return fail(`${path}.Type must be Source, Pipeline, or Sink`);
  });

  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const edges: Edge[] = [];
  for (const [target, sources] of fromByNode) {
    const targetNode = nodeById.get(target);
    sources.forEach((source, index) => {
      edges.push({
        from: { direction: "output", node: source, port: "value" },
        to: {
          direction: "input",
          node: target,
          port: `input-${String(index)}`,
        },
      });
    });
    if (targetNode === undefined) fail(`Unknown target node ${target}`);
  }
  for (const [source, target] of nextByNode) {
    if (fromByNode.has(target)) {
      if (!fromByNode.get(target)?.includes(source))
        fail(`Nodes.${source}.Next and Nodes.${target}.Inputs disagree`);
      continue;
    }
    const targetNode = nodeById.get(target);
    if (targetNode === undefined)
      fail(`Nodes.${source}.Next references unknown node ${target}`);
    if (targetNode.inputs[0] === undefined)
      fail(`Nodes.${target} has no input for Nodes.${source}.Next`);
    edges.push({
      from: { direction: "output", node: source, port: "value" },
      to: { direction: "input", node: target, port: targetNode.inputs[0].id },
    });
  }

  return {
    kind: "rsl-expression",
    version: "0.1",
    id: "rsl-workflow",
    startAt: entries as [string, ...string[]],
    nodes: nodes as [RslNode, ...RslNode[]],
    edges,
  };
}

export function normalizeRslDocument(value: RslValue): RslExpression {
  const document = mapping(value, "document");
  if (document.Version !== undefined)
    return normalizeAslInspiredDocument(document);
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
