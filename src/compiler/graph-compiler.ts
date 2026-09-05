import { defer, from, merge, type Observable } from "rxjs";

import type { RslNode } from "../model/index.js";
import type { ResolvedNode } from "../registry/index.js";
import type { ValidSemanticResult } from "../contracts/index.js";
import { RslCompilerError } from "./diagnostic.js";
import type {
  CapabilityContext,
  CompiledRslWorkflow,
  RslMultiInputOperationCapability,
  RslRuntimeWorker,
  RslSinkCapability,
  RslSourceCapability,
  RslUnaryOperationCapability,
} from "./types.js";
import {
  applyNodeScheduling,
  assertRuntimeSchedulers,
  operationScheduler,
} from "./scheduling.js";

function runtimeFunction(
  value: unknown,
  node: RslNode,
  category: string,
): (...args: never[]) => unknown {
  if (typeof value !== "function")
    throw new RslCompilerError(
      "CMP-002_INVALID_CAPABILITY",
      `Runtime ${category} capability for ${node.id} is not a function`,
      node.id,
    );
  return value as (...args: never[]) => unknown;
}

function runtimeContext(resolved: ResolvedNode): CapabilityContext {
  const value = resolved.worker?.definition.value;
  const handler = (name: "next" | "error" | "complete") => {
    const candidate = resolved.handlers?.[name]?.definition.value;
    if (candidate !== undefined && typeof candidate !== "function")
      throw new RslCompilerError(
        "CMP-003_INVALID_WORKER",
        `Runtime ${name} handler for ${resolved.node.id} is not a function`,
        resolved.node.id,
      );
    return candidate as RslRuntimeWorker | undefined;
  };
  const handlers = {
    next: handler("next"),
    error: handler("error"),
    complete: handler("complete"),
  };
  const scheduledBy = operationScheduler(resolved);
  return {
    node: resolved.node,
    parameters: resolved.node.parameters ?? {},
    ...(value === undefined ? {} : { worker: value as RslRuntimeWorker }),
    ...(scheduledBy === undefined ? {} : { scheduler: scheduledBy }),
    ...(Object.values(handlers).every((candidate) => candidate === undefined)
      ? {}
      : {
          handlers: {
            ...(handlers.next === undefined ? {} : { next: handlers.next }),
            ...(handlers.error === undefined ? {} : { error: handlers.error }),
            ...(handlers.complete === undefined
              ? {}
              : { complete: handlers.complete }),
          },
        }),
  };
}

function assertSupportedPorts(node: RslNode): void {
  if (
    (node.kind !== "sink" && node.outputs.length !== 1) ||
    (node.kind === "sink" && node.inputs.length !== 1)
  )
    throw new RslCompilerError(
      "CMP-004_UNSUPPORTED_PORT_SHAPE",
      `RSL 12 requires one output per Source/Pipeline and one input per Sink: ${node.id}`,
      node.id,
    );
}

/** Compile a validated DAG. Every cache and sharing subject is execution-local. */
export function compileRslGraph(
  semanticEvidence: ValidSemanticResult,
): CompiledRslWorkflow {
  const resolvedNodes = semanticEvidence.expression.nodes;
  const expression = semanticEvidence.expression.expression;
  const resolvedById = new Map(
    resolvedNodes.map((resolved) => [resolved.node.id, resolved]),
  );

  for (const resolved of resolvedNodes) {
    assertSupportedPorts(resolved.node);
    runtimeFunction(
      resolved.operation.definition.value,
      resolved.node,
      resolved.operation.category,
    );
    assertRuntimeSchedulers(resolved);
    const worker = resolved.worker?.definition.value;
    if (worker !== undefined && typeof worker !== "function")
      throw new RslCompilerError(
        "CMP-003_INVALID_WORKER",
        `Runtime Worker capability for ${resolved.node.id} is not a function`,
        resolved.node.id,
      );
  }

  const incoming = new Map<
    string,
    { readonly node: string; readonly port: string }
  >();
  for (const edge of expression.edges)
    incoming.set(`${edge.to.node}\u0000${edge.to.port}`, edge.from);

  const definition: Observable<never> = defer(() => {
    const streams = new Map<string, Observable<unknown>>();
    const building = new Set<string>();

    const build = (nodeId: string): Observable<unknown> => {
      const cached = streams.get(nodeId);
      if (cached !== undefined) return cached;
      const resolved = resolvedById.get(nodeId);
      if (resolved === undefined)
        throw new RslCompilerError(
          "CMP-001_UNSUPPORTED_TOPOLOGY",
          `Resolved node is missing: ${nodeId}`,
          nodeId,
        );
      if (building.has(nodeId))
        throw new RslCompilerError(
          "CMP-001_UNSUPPORTED_TOPOLOGY",
          `Cycle encountered while compiling ${nodeId}`,
          nodeId,
        );
      building.add(nodeId);

      let result: Observable<unknown>;
      if (resolved.node.kind === "source") {
        const source = runtimeFunction(
          resolved.operation.definition.value,
          resolved.node,
          "Source",
        ) as RslSourceCapability;
        result = applyNodeScheduling(
          defer(() => from(source(runtimeContext(resolved)))),
          resolved,
        );
      } else if (resolved.node.kind === "pipeline") {
        const inputs = resolved.node.inputs.map((port) => {
          const edge = incoming.get(`${nodeId}\u0000${port.id}`);
          if (edge === undefined)
            throw new RslCompilerError(
              "CMP-001_UNSUPPORTED_TOPOLOGY",
              `Input is not connected: ${nodeId}.${port.id}`,
              nodeId,
            );
          return build(edge.node);
        });
        if (inputs.length === 1) {
          const operation = runtimeFunction(
            resolved.operation.definition.value,
            resolved.node,
            "operation",
          ) as RslUnaryOperationCapability;
          result = applyNodeScheduling(
            inputs[0]?.pipe(
              operation(runtimeContext(resolved)),
            ) as Observable<unknown>,
            resolved,
          );
        } else {
          const operation = runtimeFunction(
            resolved.operation.definition.value,
            resolved.node,
            "multi-input operation",
          ) as RslMultiInputOperationCapability;
          result = applyNodeScheduling(
            operation(inputs, runtimeContext(resolved)),
            resolved,
          );
        }
      } else {
        throw new RslCompilerError(
          "CMP-001_UNSUPPORTED_TOPOLOGY",
          `A Sink cannot feed another node: ${nodeId}`,
          nodeId,
        );
      }
      building.delete(nodeId);
      streams.set(nodeId, result);
      return result;
    };

    const terminals = resolvedNodes
      .filter((resolved) => resolved.node.kind === "sink")
      .map((resolved) => {
        const input = resolved.node.inputs[0];
        const edge =
          input === undefined
            ? undefined
            : incoming.get(`${resolved.node.id}\u0000${input.id}`);
        if (edge === undefined)
          throw new RslCompilerError(
            "CMP-001_UNSUPPORTED_TOPOLOGY",
            `Sink input is not connected: ${resolved.node.id}`,
            resolved.node.id,
          );
        const sink = runtimeFunction(
          resolved.operation.definition.value,
          resolved.node,
          "Sink",
        ) as RslSinkCapability;
        return sink(
          applyNodeScheduling(build(edge.node), resolved),
          runtimeContext(resolved),
        );
      });
    return merge(...terminals);
  });

  return Object.freeze({
    kind: "compiled-rsl-workflow",
    expressionId: expression.id,
    definition,
    semanticEvidence,
  });
}
