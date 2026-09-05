import type {
  RslExpression,
  SchedulerRef,
  TypeRef,
  WorkerBinding,
} from "../model/index.js";
import { RslRegistryError, type RegistryDiagnostic } from "./diagnostic.js";
import { REFERENCE_PATTERN } from "./registry.js";
import type {
  RegistryCategory,
  RegistryDefinition,
  ResolvedNode,
  ResolvedReference,
  ResolvedRslExpression,
  ResolvedTypeReference,
  RslRegistries,
  RslRegistry,
} from "./types.js";

export interface ValidReferenceResolution {
  readonly valid: true;
  readonly diagnostics: readonly [];
  readonly resolved: ResolvedRslExpression;
}

export interface InvalidReferenceResolution {
  readonly valid: false;
  readonly diagnostics: readonly RegistryDiagnostic[];
}

export type ReferenceResolutionResult =
  ValidReferenceResolution | InvalidReferenceResolution;

interface SymbolicReference {
  readonly ref: string;
  readonly version?: string;
}

const REGISTRY_KEYS = [
  ["source", "sources"],
  ["operation", "operations"],
  ["sink", "sinks"],
  ["worker", "workers"],
  ["scheduler", "schedulers"],
  ["type", "types"],
] as const;

function registryFor<Category extends RegistryCategory>(
  registries: RslRegistries,
  category: Category,
): RslRegistry<Category> {
  const pair = REGISTRY_KEYS.find(([candidate]) => candidate === category);
  const key = pair?.[1];
  if (key === undefined)
    throw new Error(`Unsupported registry category: ${category}`);
  return registries[key] as RslRegistry<Category>;
}

function otherCategories(
  registries: RslRegistries,
  expected: RegistryCategory,
  ref: string,
): RegistryCategory[] {
  return REGISTRY_KEYS.filter(
    ([category, key]) =>
      category !== expected &&
      registries[key].definitions.some((definition) => definition.ref === ref),
  ).map(([category]) => category);
}

function resolveOne<Category extends RegistryCategory>(
  reference: SymbolicReference,
  expectedCategory: Category,
  path: string,
  registries: RslRegistries,
  diagnostics: RegistryDiagnostic[],
): ResolvedReference<Category> | undefined {
  if (!REFERENCE_PATTERN.test(reference.ref)) {
    diagnostics.push({
      code: "REG-001_INVALID_REFERENCE",
      message: `Invalid ${expectedCategory} reference: ${reference.ref}`,
      path,
      expectedCategory,
      ref: reference.ref,
      ...(reference.version === undefined
        ? {}
        : { version: reference.version }),
    });
    return undefined;
  }

  const registry = registryFor(registries, expectedCategory);
  const candidates = registry.definitions.filter(
    (definition) => definition.ref === reference.ref,
  );
  let definition: RegistryDefinition<Category> | undefined;
  if (reference.version !== undefined) {
    definition = candidates.find(
      (candidate) => candidate.version === reference.version,
    );
    if (definition === undefined && candidates.length > 0) {
      diagnostics.push({
        code: "REG-005_VERSION_MISMATCH",
        message: `No ${expectedCategory} definition ${reference.ref}@${reference.version}; available versions: ${candidates.map((candidate) => candidate.version ?? "unversioned").join(", ")}`,
        path,
        expectedCategory,
        ref: reference.ref,
        version: reference.version,
      });
      return undefined;
    }
  } else if (candidates.length === 1) {
    definition = candidates[0];
  } else if (candidates.length > 1) {
    diagnostics.push({
      code: "REG-004_AMBIGUOUS_REFERENCE",
      message: `Unversioned ${expectedCategory} reference is ambiguous: ${reference.ref}`,
      path,
      expectedCategory,
      ref: reference.ref,
    });
    return undefined;
  }

  if (definition === undefined) {
    const actualCategories = otherCategories(
      registries,
      expectedCategory,
      reference.ref,
    );
    diagnostics.push({
      code:
        actualCategories.length === 0
          ? "REG-003_MISSING_REFERENCE"
          : "REG-006_WRONG_CATEGORY",
      message:
        actualCategories.length === 0
          ? `Missing ${expectedCategory} definition: ${reference.ref}`
          : `Reference ${reference.ref} is registered as ${actualCategories.join(", ")}, not ${expectedCategory}`,
      path,
      expectedCategory,
      ref: reference.ref,
      ...(reference.version === undefined
        ? {}
        : { version: reference.version }),
      ...(actualCategories.length === 0 ? {} : { actualCategories }),
    });
    return undefined;
  }

  return {
    category: expectedCategory,
    ref: reference.ref,
    ...(reference.version === undefined
      ? {}
      : { requestedVersion: reference.version }),
    definition,
  };
}

function visitTypeRefs(
  type: TypeRef,
  path: string,
  visit: (type: TypeRef, path: string) => void,
): void {
  visit(type, path);
  if (type.kind === "array") visitTypeRefs(type.items, `${path}.items`, visit);
  else if (type.kind === "tuple")
    type.items.forEach((item, index) => {
      visitTypeRefs(item, `${path}.items[${String(index)}]`, visit);
    });
  else if (type.kind === "record")
    Object.entries(type.fields).forEach(([key, item]) => {
      visitTypeRefs(item, `${path}.fields.${key}`, visit);
    });
  else if (type.kind === "union")
    type.members.forEach((item, index) => {
      visitTypeRefs(item, `${path}.members[${String(index)}]`, visit);
    });
  else if (type.kind === "generic")
    type.arguments.forEach((item, index) => {
      visitTypeRefs(item, `${path}.arguments[${String(index)}]`, visit);
    });
  else if (type.kind === "observable")
    visitTypeRefs(type.value, `${path}.value`, visit);
}

export function validateRslReferences(
  expression: RslExpression,
  registries: RslRegistries,
): ReferenceResolutionResult {
  const diagnostics: RegistryDiagnostic[] = [];
  const resolvedNodes: ResolvedNode[] = [];
  const resolvedTypes: ResolvedTypeReference[] = [];

  expression.nodes.forEach((node, nodeIndex) => {
    const nodePath = `nodes[${String(nodeIndex)}]`;
    const category =
      node.kind === "source"
        ? "source"
        : node.kind === "pipeline"
          ? "operation"
          : "sink";
    const operation = resolveOne(
      node.operation,
      category,
      `${nodePath}.operation`,
      registries,
      diagnostics,
    );
    const worker =
      node.worker === undefined
        ? undefined
        : resolveOne(
            node.worker.worker,
            "worker",
            `${nodePath}.worker`,
            registries,
            diagnostics,
          );
    const resolveScheduler = (
      reference: SchedulerRef | undefined,
      role: "operation" | "subscribeOn" | "observeOn",
    ) =>
      reference === undefined
        ? undefined
        : resolveOne(
            reference,
            "scheduler",
            `${nodePath}.scheduler.${role}`,
            registries,
            diagnostics,
          );
    const operationScheduler = resolveScheduler(
      node.scheduler?.operation ?? node.scheduler?.scheduler,
      "operation",
    );
    const subscribeOnScheduler = resolveScheduler(
      node.scheduler?.subscribeOn,
      "subscribeOn",
    );
    const observeOnScheduler = resolveScheduler(
      node.scheduler?.observeOn,
      "observeOn",
    );
    const schedulers =
      operationScheduler === undefined &&
      subscribeOnScheduler === undefined &&
      observeOnScheduler === undefined
        ? undefined
        : {
            operation: operationScheduler,
            subscribeOn: subscribeOnScheduler,
            observeOn: observeOnScheduler,
          };
    const resolveHandler = (
      binding: WorkerBinding | undefined,
      name: "next" | "error" | "complete",
    ) =>
      binding === undefined
        ? undefined
        : resolveOne(
            binding.worker,
            "worker",
            `${nodePath}.handlers.${name}`,
            registries,
            diagnostics,
          );
    const handlers =
      node.kind === "sink" && node.handlers !== undefined
        ? {
            next: resolveHandler(node.handlers.next, "next"),
            error: resolveHandler(node.handlers.error, "error"),
            complete: resolveHandler(node.handlers.complete, "complete"),
          }
        : undefined;
    if (operation !== undefined) {
      resolvedNodes.push({
        node,
        operation,
        ...(worker === undefined ? {} : { worker }),
        ...(operationScheduler === undefined
          ? {}
          : { scheduler: operationScheduler }),
        ...(schedulers === undefined
          ? {}
          : {
              schedulers: {
                ...(schedulers.operation === undefined
                  ? {}
                  : { operation: schedulers.operation }),
                ...(schedulers.subscribeOn === undefined
                  ? {}
                  : { subscribeOn: schedulers.subscribeOn }),
                ...(schedulers.observeOn === undefined
                  ? {}
                  : { observeOn: schedulers.observeOn }),
              },
            }),
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
      });
    }

    const resolveType = (type: TypeRef, path: string): void => {
      if (type.kind !== "named" && type.kind !== "generic") return;
      const resolved = resolveOne(
        { ref: type.ref },
        "type",
        path,
        registries,
        diagnostics,
      );
      if (resolved !== undefined)
        resolvedTypes.push({ path, type, definition: resolved.definition });
    };
    node.inputs.forEach((port, portIndex) => {
      visitTypeRefs(
        port.type,
        `${nodePath}.inputs[${String(portIndex)}].type`,
        resolveType,
      );
    });
    node.outputs.forEach((port, portIndex) => {
      visitTypeRefs(
        port.type,
        `${nodePath}.outputs[${String(portIndex)}].type`,
        resolveType,
      );
    });
    if (node.worker?.input !== undefined)
      visitTypeRefs(node.worker.input, `${nodePath}.worker.input`, resolveType);
    if (node.worker?.output !== undefined)
      visitTypeRefs(
        node.worker.output,
        `${nodePath}.worker.output`,
        resolveType,
      );
    node.worker?.contract?.inputs.forEach((type, index) => {
      visitTypeRefs(
        type,
        `${nodePath}.worker.contract.inputs[${String(index)}]`,
        resolveType,
      );
    });
    if (node.worker?.contract !== undefined)
      visitTypeRefs(
        node.worker.contract.output,
        `${nodePath}.worker.contract.output`,
        resolveType,
      );
    if (node.kind === "sink" && node.handlers !== undefined) {
      for (const [name, binding] of Object.entries(node.handlers)) {
        if (binding.input !== undefined)
          visitTypeRefs(
            binding.input,
            `${nodePath}.handlers.${name}.input`,
            resolveType,
          );
        if (binding.output !== undefined)
          visitTypeRefs(
            binding.output,
            `${nodePath}.handlers.${name}.output`,
            resolveType,
          );
      }
    }
  });

  return diagnostics.length === 0
    ? {
        valid: true,
        diagnostics: [],
        resolved: {
          expression,
          nodes: resolvedNodes,
          types: resolvedTypes,
        },
      }
    : { valid: false, diagnostics };
}

export function resolveRslReferences(
  expression: RslExpression,
  registries: RslRegistries,
): ResolvedRslExpression {
  const result = validateRslReferences(expression, registries);
  if (!result.valid) throw new RslRegistryError(result.diagnostics);
  return result.resolved;
}
