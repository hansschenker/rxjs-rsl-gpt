import type { RslNode, TypeRef, WorkerContract } from "../model/index.js";
import type {
  ResolvedNode,
  ResolvedRslExpression,
  RslRegistries,
} from "../registry/index.js";
import { areTypeRefsEqual, isTypeRefAssignable } from "./compatibility.js";
import { RslSemanticError, type SemanticDiagnostic } from "./diagnostic.js";
import {
  inferRslValueType,
  type ArityContract,
  type ContractTypeTerm,
  type NodeOperationContract,
  type SemanticValidationOptions,
} from "./types.js";

export interface ValidSemanticResult {
  readonly valid: true;
  readonly diagnostics: readonly [];
  readonly expression: ResolvedRslExpression;
  readonly profile: "exact" | "assignable";
}

export interface InvalidSemanticResult {
  readonly valid: false;
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly profile: "exact" | "assignable";
}

export type SemanticValidationResult =
  ValidSemanticResult | InvalidSemanticResult;

function arityMatches(actual: number, contract: ArityContract): boolean {
  return actual >= contract.min && actual <= contract.max;
}

function operationContract(
  node: ResolvedNode,
): NodeOperationContract | undefined {
  return node.operation.definition.contract;
}

function workerContract(node: ResolvedNode): WorkerContract | undefined {
  return node.worker?.definition.contract;
}

function termType(
  term: ContractTypeTerm,
  node: RslNode,
  worker: WorkerContract | undefined,
): TypeRef | undefined {
  if (term.kind === "node-input") return node.inputs[term.index]?.type;
  if (term.kind === "node-input-error")
    return (
      node.inputs[term.index]?.errorType ?? {
        kind: "primitive",
        name: "unknown",
      }
    );
  if (term.kind === "node-output") return node.outputs[term.index]?.type;
  if (term.kind === "node-output-error")
    return (
      node.outputs[term.index]?.errorType ?? {
        kind: "primitive",
        name: "unknown",
      }
    );
  if (term.kind === "worker-input") return worker?.inputs[term.index];
  if (term.kind === "worker-output") return worker?.output;
  if (term.kind === "worker-output-value")
    return worker?.output.kind === "observable"
      ? worker.output.value
      : undefined;
  return term.type;
}

export function validateRslSemantics(
  resolved: ResolvedRslExpression,
  registries: RslRegistries,
  options: SemanticValidationOptions = {},
): SemanticValidationResult {
  const profile = options.profile ?? "exact";
  const context = { profile, types: registries.types } as const;
  const diagnostics: SemanticDiagnostic[] = [];
  const nodeById = new Map(
    resolved.expression.nodes.map((node) => [node.id, node]),
  );

  resolved.expression.edges.forEach((edge, edgeIndex) => {
    const source = nodeById
      .get(edge.from.node)
      ?.outputs.find((port) => port.id === edge.from.port);
    const target = nodeById
      .get(edge.to.node)
      ?.inputs.find((port) => port.id === edge.to.port);
    if (
      source !== undefined &&
      target !== undefined &&
      !isTypeRefAssignable(source.type, target.type, context)
    ) {
      diagnostics.push({
        code: "TYP-001_INCOMPATIBLE_EDGE",
        message: `Edge ${edge.from.node}.${edge.from.port} is not ${profile}-compatible with ${edge.to.node}.${edge.to.port}`,
        path: `edges[${String(edgeIndex)}]`,
        edgeIndex,
      });
    }
    if (
      source?.errorType !== undefined &&
      target?.errorType !== undefined &&
      !isTypeRefAssignable(source.errorType, target.errorType, context)
    ) {
      diagnostics.push({
        code: "TYP-001_INCOMPATIBLE_EDGE",
        message: `Error channel ${edge.from.node}.${edge.from.port} is not ${profile}-compatible with ${edge.to.node}.${edge.to.port}`,
        path: `edges[${String(edgeIndex)}].error`,
        edgeIndex,
      });
    }
    if (source?.complete === true && target?.complete === false) {
      diagnostics.push({
        code: "TYP-001_INCOMPATIBLE_EDGE",
        message: `Completion from ${edge.from.node}.${edge.from.port} is not accepted by ${edge.to.node}.${edge.to.port}`,
        path: `edges[${String(edgeIndex)}].complete`,
        edgeIndex,
      });
    }
  });

  resolved.nodes.forEach((resolvedNode, nodeIndex) => {
    const { node } = resolvedNode;
    const path = `nodes[${String(nodeIndex)}]`;
    const contract = operationContract(resolvedNode);
    if (contract === undefined) {
      diagnostics.push({
        code: "TYP-002_MISSING_OPERATION_CONTRACT",
        message: `Resolved ${resolvedNode.operation.category} ${resolvedNode.operation.ref} has no operation contract`,
        path: `${path}.operation`,
        nodeId: node.id,
      });
      return;
    }
    if (
      !arityMatches(node.inputs.length, contract.inputArity) ||
      !arityMatches(node.outputs.length, contract.outputArity)
    ) {
      diagnostics.push({
        code: "TYP-003_OPERATION_ARITY",
        message: `Node ${node.id} arity (${String(node.inputs.length)}, ${String(node.outputs.length)}) violates its operation contract`,
        path,
        nodeId: node.id,
      });
    }

    const requirement = contract.worker;
    if (requirement === undefined && node.worker !== undefined) {
      diagnostics.push({
        code: "TYP-004_UNEXPECTED_WORKER",
        message: `Operation ${resolvedNode.operation.ref} does not accept a Worker`,
        path: `${path}.worker`,
        nodeId: node.id,
      });
    } else if (requirement?.required === true && node.worker === undefined) {
      diagnostics.push({
        code: "TYP-005_MISSING_WORKER",
        message: `Operation ${resolvedNode.operation.ref} requires a Worker`,
        path: `${path}.worker`,
        nodeId: node.id,
      });
    }

    const worker = workerContract(resolvedNode);
    if (node.worker !== undefined && worker === undefined) {
      diagnostics.push({
        code: "TYP-006_MISSING_WORKER_CONTRACT",
        message: `Worker ${node.worker.worker.ref} has no semantic contract`,
        path: `${path}.worker`,
        nodeId: node.id,
      });
    }
    if (worker !== undefined && requirement !== undefined) {
      if (!requirement.categories.includes(worker.category)) {
        diagnostics.push({
          code: "TYP-007_WORKER_CATEGORY",
          message: `Worker category ${worker.category} is not accepted by ${resolvedNode.operation.ref}`,
          path: `${path}.worker`,
          nodeId: node.id,
        });
      }
      if (
        requirement.purity !== undefined &&
        worker.purity !== requirement.purity
      ) {
        diagnostics.push({
          code: "TYP-008_WORKER_PURITY",
          message: `Worker purity ${worker.purity} does not satisfy required ${requirement.purity}`,
          path: `${path}.worker`,
          nodeId: node.id,
        });
      }
      if (
        requirement.inputArity !== undefined &&
        !arityMatches(worker.inputs.length, requirement.inputArity)
      ) {
        diagnostics.push({
          code: "TYP-009_WORKER_ARITY",
          message: `Worker input arity ${String(worker.inputs.length)} violates its operation requirement`,
          path: `${path}.worker`,
          nodeId: node.id,
        });
      }
    }

    if (
      worker !== undefined &&
      node.worker?.input !== undefined &&
      !areTypeRefsEqual(node.worker.input, worker.inputs[0])
    ) {
      diagnostics.push({
        code: "TYP-011_DECLARED_WORKER_TYPE",
        message: `Declared Worker input differs from registry contract for ${node.worker.worker.ref}`,
        path: `${path}.worker.input`,
        nodeId: node.id,
      });
    }
    if (
      worker !== undefined &&
      node.worker?.output !== undefined &&
      !areTypeRefsEqual(node.worker.output, worker.output)
    ) {
      diagnostics.push({
        code: "TYP-011_DECLARED_WORKER_TYPE",
        message: `Declared Worker output differs from registry contract for ${node.worker.worker.ref}`,
        path: `${path}.worker.output`,
        nodeId: node.id,
      });
    }

    for (const [constraintIndex, constraint] of (
      contract.constraints ?? []
    ).entries()) {
      const source = termType(constraint.source, node, worker);
      const target = termType(constraint.target, node, worker);
      const valid =
        source !== undefined &&
        target !== undefined &&
        (constraint.relation === "equal"
          ? areTypeRefsEqual(source, target)
          : isTypeRefAssignable(source, target, context));
      if (!valid) {
        diagnostics.push({
          code: "TYP-010_CONTRACT_CONSTRAINT",
          message: `Operation type constraint ${String(constraintIndex)} failed for ${node.id}`,
          path: `${path}.operation.constraints[${String(constraintIndex)}]`,
          nodeId: node.id,
        });
      }
    }

    if (contract.reducer !== undefined) {
      const seed = node.parameters?.[contract.reducer.seedParameter];
      if (seed === undefined) {
        diagnostics.push({
          code: "TYP-012_MISSING_REDUCER_SEED",
          message: `Reducer operation ${node.id} requires parameter ${contract.reducer.seedParameter}`,
          path: `${path}.parameters.${contract.reducer.seedParameter}`,
          nodeId: node.id,
        });
      } else {
        const stateType = worker?.inputs[contract.reducer.stateInput];
        if (
          stateType !== undefined &&
          !isTypeRefAssignable(inferRslValueType(seed), stateType, context)
        ) {
          diagnostics.push({
            code: "TYP-013_REDUCER_SEED_TYPE",
            message: `Reducer seed ${contract.reducer.seedParameter} is incompatible with its state type`,
            path: `${path}.parameters.${contract.reducer.seedParameter}`,
            nodeId: node.id,
          });
        }
      }
    }
  });

  return diagnostics.length === 0
    ? { valid: true, diagnostics: [], expression: resolved, profile }
    : { valid: false, diagnostics, profile };
}

export function assertValidRslSemantics(
  resolved: ResolvedRslExpression,
  registries: RslRegistries,
  options: SemanticValidationOptions = {},
): ValidSemanticResult {
  const result = validateRslSemantics(resolved, registries, options);
  if (!result.valid) throw new RslSemanticError(result.diagnostics);
  return result;
}
