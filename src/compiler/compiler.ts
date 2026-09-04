import { defer, from, type Observable } from "rxjs";

import type { RslNode } from "../model/index.js";
import type { ResolvedNode } from "../registry/index.js";
import type { ValidSemanticResult } from "../contracts/index.js";
import { RslCompilerError } from "./diagnostic.js";
import type {
  CapabilityContext,
  CompiledRslWorkflow,
  RslRuntimeWorker,
  RslSinkCapability,
  RslSourceCapability,
  RslUnaryOperationCapability,
} from "./types.js";

function capability(
  value: unknown,
  node: RslNode,
  category: string,
): (...args: never[]) => unknown {
  if (typeof value !== "function") {
    throw new RslCompilerError(
      "CMP-002_INVALID_CAPABILITY",
      `Runtime ${category} capability for ${node.id} is not a function`,
      node.id,
    );
  }
  return value as (...args: never[]) => unknown;
}

function context(resolved: ResolvedNode): CapabilityContext {
  const workerValue = resolved.worker?.definition.value;
  if (workerValue !== undefined && typeof workerValue !== "function") {
    throw new RslCompilerError(
      "CMP-003_INVALID_WORKER",
      `Runtime Worker capability for ${resolved.node.id} is not a function`,
      resolved.node.id,
    );
  }
  return {
    node: resolved.node,
    parameters: resolved.node.parameters ?? {},
    ...(workerValue === undefined
      ? {}
      : { worker: workerValue as RslRuntimeWorker }),
  };
}

function assertWorkerShape(resolved: ResolvedNode): void {
  const value = resolved.worker?.definition.value;
  if (value !== undefined && typeof value !== "function") {
    throw new RslCompilerError(
      "CMP-003_INVALID_WORKER",
      `Runtime Worker capability for ${resolved.node.id} is not a function`,
      resolved.node.id,
    );
  }
}

function orderedUnaryPath(
  evidence: ValidSemanticResult,
): readonly ResolvedNode[] {
  const { expression, nodes } = evidence.expression;
  const resolvedById = new Map(nodes.map((node) => [node.node.id, node]));
  const sources = expression.nodes.filter((node) => node.kind === "source");
  const sinks = expression.nodes.filter((node) => node.kind === "sink");
  if (sources.length !== 1 || sinks.length !== 1) {
    throw new RslCompilerError(
      "CMP-001_UNSUPPORTED_TOPOLOGY",
      "RSL 11 requires exactly one Source and one Sink",
    );
  }

  const outgoing = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const edge of expression.edges) {
    if (outgoing.has(edge.from.node)) {
      throw new RslCompilerError(
        "CMP-001_UNSUPPORTED_TOPOLOGY",
        `RSL 11 does not support branching at ${edge.from.node}`,
        edge.from.node,
      );
    }
    outgoing.set(edge.from.node, edge.to.node);
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
  }
  if ([...incoming.values()].some((count) => count !== 1)) {
    throw new RslCompilerError(
      "CMP-001_UNSUPPORTED_TOPOLOGY",
      "RSL 11 supports only unary Pipeline inputs",
    );
  }

  const path: ResolvedNode[] = [];
  const visited = new Set<string>();
  let current: string | undefined = sources[0]?.id;
  while (current !== undefined) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = resolvedById.get(current);
    if (node === undefined) break;
    path.push(node);
    current = outgoing.get(current);
  }
  if (
    path.length !== nodes.length ||
    path[0]?.node.kind !== "source" ||
    path.at(-1)?.node.kind !== "sink"
  ) {
    throw new RslCompilerError(
      "CMP-001_UNSUPPORTED_TOPOLOGY",
      "RSL 11 requires one connected Source-to-Sink unary path",
    );
  }
  return path;
}

export function compileRslUnary(
  semanticEvidence: ValidSemanticResult,
): CompiledRslWorkflow {
  const path = orderedUnaryPath(semanticEvidence);
  const sourceNode = path[0];
  const sinkNode = path.at(-1);
  if (sourceNode === undefined || sinkNode === undefined)
    throw new RslCompilerError(
      "CMP-001_UNSUPPORTED_TOPOLOGY",
      "RSL 11 requires a Source-to-Sink path",
    );

  // Shape inspection is static; no registry capability is invoked here.
  const sourceFactory = capability(
    sourceNode.operation.definition.value,
    sourceNode.node,
    "Source",
  ) as RslSourceCapability;
  const operations = path.slice(1, -1).map((pipeline) => ({
    pipeline,
    capability: capability(
      pipeline.operation.definition.value,
      pipeline.node,
      "operation",
    ) as RslUnaryOperationCapability,
  }));
  const sink = capability(
    sinkNode.operation.definition.value,
    sinkNode.node,
    "Sink",
  ) as RslSinkCapability;
  path.forEach(assertWorkerShape);

  // The whole factory is deferred. Factories and Workers run per subscription.
  const definition: Observable<never> = defer(() => {
    let stream: Observable<unknown> = from(sourceFactory(context(sourceNode)));

    for (const operation of operations) {
      stream = stream.pipe(operation.capability(context(operation.pipeline)));
    }

    return sink(stream, context(sinkNode));
  });

  return Object.freeze({
    kind: "compiled-rsl-workflow",
    expressionId: semanticEvidence.expression.expression.id,
    definition,
    semanticEvidence,
  });
}
