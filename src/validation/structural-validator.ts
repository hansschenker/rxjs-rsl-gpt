import type { RslExpression, RslNode } from "../model/index.js";
import type {
  StructuralDiagnostic,
  StructuralDiagnosticCode,
} from "./diagnostic.js";

const LOCAL_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

export interface ValidStructure {
  readonly valid: true;
  readonly diagnostics: readonly [];
  /** Stable dependency order; node declaration order breaks ties. */
  readonly topologicalOrder: readonly string[];
}

export interface InvalidStructure {
  readonly valid: false;
  readonly diagnostics: readonly StructuralDiagnostic[];
}

export type StructuralValidationResult = ValidStructure | InvalidStructure;

export class RslStructuralError extends Error {
  public override readonly name = "RslStructuralError";

  public constructor(
    public readonly diagnostics: readonly StructuralDiagnostic[],
  ) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `RSL structure has ${String(diagnostics.length)} errors`,
    );
  }
}

function diagnostic(
  code: StructuralDiagnosticCode,
  message: string,
  path: string,
  context: Omit<StructuralDiagnostic, "code" | "message" | "path"> = {},
): StructuralDiagnostic {
  return { code, message, path, ...context };
}

function address(node: string, port: string): string {
  return `${node}:${port}`;
}

export function validateRslStructure(
  expression: RslExpression,
): StructuralValidationResult {
  const diagnostics: StructuralDiagnostic[] = [];
  const nodeById = new Map<string, RslNode>();
  const nodeIndexById = new Map<string, number>();
  const ambiguousNodeIds = new Set<string>();

  if (!LOCAL_ID.test(expression.id)) {
    diagnostics.push(
      diagnostic(
        "STR-001_INVALID_LOCAL_ID",
        `Invalid expression identity: ${expression.id}`,
        "expression.id",
      ),
    );
  }

  expression.nodes.forEach((node, nodeIndex) => {
    const path = `nodes[${String(nodeIndex)}]`;
    if (!LOCAL_ID.test(node.id)) {
      diagnostics.push(
        diagnostic(
          "STR-001_INVALID_LOCAL_ID",
          `Invalid node identity: ${node.id}`,
          `${path}.id`,
          { nodeId: node.id },
        ),
      );
    }
    if (nodeById.has(node.id)) {
      ambiguousNodeIds.add(node.id);
      diagnostics.push(
        diagnostic(
          "STR-002_DUPLICATE_NODE_ID",
          `Duplicate node identity: ${node.id}`,
          `${path}.id`,
          { nodeId: node.id },
        ),
      );
    } else {
      nodeById.set(node.id, node);
      nodeIndexById.set(node.id, nodeIndex);
    }

    const portIds = new Set<string>();
    [...node.inputs, ...node.outputs].forEach((port) => {
      const collection = port.direction === "input" ? "inputs" : "outputs";
      const portIndex =
        collection === "inputs"
          ? node.inputs.indexOf(port as never)
          : node.outputs.indexOf(port as never);
      const portPath = `${path}.${collection}[${String(portIndex)}]`;
      if (!LOCAL_ID.test(port.id)) {
        diagnostics.push(
          diagnostic(
            "STR-001_INVALID_LOCAL_ID",
            `Invalid port identity: ${node.id}.${port.id}`,
            `${portPath}.id`,
            { nodeId: node.id, portId: port.id },
          ),
        );
      }
      if (portIds.has(port.id)) {
        diagnostics.push(
          diagnostic(
            "STR-003_DUPLICATE_PORT_ID",
            `Duplicate port identity in ${node.id}: ${port.id}`,
            `${portPath}.id`,
            { nodeId: node.id, portId: port.id },
          ),
        );
      } else portIds.add(port.id);
    });
  });

  const sources = expression.nodes.filter((node) => node.kind === "source");
  const sinks = expression.nodes.filter((node) => node.kind === "sink");
  if (sources.length === 0)
    diagnostics.push(
      diagnostic(
        "STR-004_MISSING_SOURCE",
        "An RSL expression requires at least one Source",
        "nodes",
      ),
    );
  if (sinks.length === 0)
    diagnostics.push(
      diagnostic(
        "STR-005_MISSING_SINK",
        "An RSL expression requires at least one Sink",
        "nodes",
      ),
    );
  if (expression.startAt !== undefined) {
    const seen = new Set<string>();
    expression.startAt.forEach((nodeId, index) => {
      const node = nodeById.get(nodeId);
      if (seen.has(nodeId) || node?.kind !== "source")
        diagnostics.push(
          diagnostic(
            "STR-017_INVALID_START_AT",
            seen.has(nodeId)
              ? `Duplicate StartAt Source: ${nodeId}`
              : `StartAt must reference a Source: ${nodeId}`,
            `startAt[${String(index)}]`,
            { nodeId },
          ),
        );
      seen.add(nodeId);
    });
    for (const source of sources)
      if (!seen.has(source.id))
        diagnostics.push(
          diagnostic(
            "STR-017_INVALID_START_AT",
            `Source ${source.id} is not declared in StartAt`,
            "startAt",
            { nodeId: source.id },
          ),
        );
  }

  expression.nodes.forEach((node, nodeIndex) => {
    const runtimeNode = node as {
      readonly kind: string;
      readonly inputs: readonly unknown[];
      readonly outputs: readonly unknown[];
    };
    const valid =
      (runtimeNode.kind === "source" &&
        runtimeNode.inputs.length === 0 &&
        runtimeNode.outputs.length > 0) ||
      (runtimeNode.kind === "pipeline" &&
        runtimeNode.inputs.length > 0 &&
        runtimeNode.outputs.length > 0) ||
      (runtimeNode.kind === "sink" &&
        runtimeNode.inputs.length > 0 &&
        runtimeNode.outputs.length === 0);
    if (!valid)
      diagnostics.push(
        diagnostic(
          "STR-006_INVALID_NODE_POLARITY",
          `Node ${node.id} violates ${node.kind} port polarity`,
          `nodes[${String(nodeIndex)}]`,
          { nodeId: node.id },
        ),
      );
  });

  const usableEdges: Array<{ readonly from: string; readonly to: string }> = [];
  const edgeKeys = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  expression.edges.forEach((edge, edgeIndex) => {
    const path = `edges[${String(edgeIndex)}]`;
    const runtimeEdge = edge as {
      readonly from: { readonly direction: string };
      readonly to: { readonly direction: string };
    };
    if (
      runtimeEdge.from.direction !== "output" ||
      runtimeEdge.to.direction !== "input"
    ) {
      diagnostics.push(
        diagnostic(
          "STR-007_INVALID_EDGE_DIRECTION",
          "An edge must connect output to input",
          path,
          { edgeIndex },
        ),
      );
      return;
    }
    const fromNode = nodeById.get(edge.from.node);
    const toNode = nodeById.get(edge.to.node);
    let endpointsValid = true;
    if (fromNode === undefined || ambiguousNodeIds.has(edge.from.node)) {
      diagnostics.push(
        diagnostic(
          "STR-008_UNKNOWN_EDGE_NODE",
          `Unknown or ambiguous source node: ${edge.from.node}`,
          `${path}.from.node`,
          { edgeIndex, nodeId: edge.from.node },
        ),
      );
      endpointsValid = false;
    }
    if (toNode === undefined || ambiguousNodeIds.has(edge.to.node)) {
      diagnostics.push(
        diagnostic(
          "STR-008_UNKNOWN_EDGE_NODE",
          `Unknown or ambiguous target node: ${edge.to.node}`,
          `${path}.to.node`,
          { edgeIndex, nodeId: edge.to.node },
        ),
      );
      endpointsValid = false;
    }
    if (
      fromNode !== undefined &&
      !ambiguousNodeIds.has(edge.from.node) &&
      !fromNode.outputs.some((port) => port.id === edge.from.port)
    ) {
      diagnostics.push(
        diagnostic(
          "STR-009_UNKNOWN_EDGE_PORT",
          `Unknown output port: ${edge.from.node}.${edge.from.port}`,
          `${path}.from.port`,
          { edgeIndex, nodeId: edge.from.node, portId: edge.from.port },
        ),
      );
      endpointsValid = false;
    }
    if (
      toNode !== undefined &&
      !ambiguousNodeIds.has(edge.to.node) &&
      !toNode.inputs.some((port) => port.id === edge.to.port)
    ) {
      diagnostics.push(
        diagnostic(
          "STR-009_UNKNOWN_EDGE_PORT",
          `Unknown input port: ${edge.to.node}.${edge.to.port}`,
          `${path}.to.port`,
          { edgeIndex, nodeId: edge.to.node, portId: edge.to.port },
        ),
      );
      endpointsValid = false;
    }
    if (!endpointsValid) return;
    const key = `${address(edge.from.node, edge.from.port)}->${address(edge.to.node, edge.to.port)}`;
    if (edgeKeys.has(key)) {
      diagnostics.push(
        diagnostic("STR-010_DUPLICATE_EDGE", `Duplicate edge: ${key}`, path, {
          edgeIndex,
        }),
      );
    } else edgeKeys.add(key);
    const input = address(edge.to.node, edge.to.port);
    const output = address(edge.from.node, edge.from.port);
    incoming.set(input, (incoming.get(input) ?? 0) + 1);
    outgoing.set(output, (outgoing.get(output) ?? 0) + 1);
    usableEdges.push({ from: edge.from.node, to: edge.to.node });
  });

  expression.nodes.forEach((node, nodeIndex) => {
    node.inputs.forEach((port, portIndex) => {
      const count = incoming.get(address(node.id, port.id)) ?? 0;
      if (count === 0)
        diagnostics.push(
          diagnostic(
            "STR-011_UNCONNECTED_INPUT",
            `Input has no incoming edge: ${node.id}.${port.id}`,
            `nodes[${String(nodeIndex)}].inputs[${String(portIndex)}]`,
            { nodeId: node.id, portId: port.id },
          ),
        );
      else if (count > 1)
        diagnostics.push(
          diagnostic(
            "STR-012_MULTIPLE_INPUT_EDGES",
            `Input has ${String(count)} incoming edges: ${node.id}.${port.id}`,
            `nodes[${String(nodeIndex)}].inputs[${String(portIndex)}]`,
            { nodeId: node.id, portId: port.id },
          ),
        );
    });
    node.outputs.forEach((port, portIndex) => {
      if ((outgoing.get(address(node.id, port.id)) ?? 0) === 0)
        diagnostics.push(
          diagnostic(
            "STR-013_UNUSED_OUTPUT",
            `Output has no outgoing edge: ${node.id}.${port.id}`,
            `nodes[${String(nodeIndex)}].outputs[${String(portIndex)}]`,
            { nodeId: node.id, portId: port.id },
          ),
        );
    });
  });

  const adjacency = new Map(
    expression.nodes.map((node) => [node.id, [] as string[]]),
  );
  const reverse = new Map(
    expression.nodes.map((node) => [node.id, [] as string[]]),
  );
  for (const edge of usableEdges) {
    adjacency.get(edge.from)?.push(edge.to);
    reverse.get(edge.to)?.push(edge.from);
  }
  const indegree = new Map(expression.nodes.map((node) => [node.id, 0]));
  for (const edge of usableEdges)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const ready = expression.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
        ready.sort(
          (left, right) =>
            (nodeIndexById.get(left) ?? 0) - (nodeIndexById.get(right) ?? 0),
        );
      }
    }
  }
  if (order.length !== expression.nodes.length) {
    const cyclic = expression.nodes
      .filter((node) => !order.includes(node.id))
      .map((node) => node.id);
    diagnostics.push(
      diagnostic(
        "STR-014_CYCLE",
        `Directed cycle detected among: ${cyclic.join(", ")}`,
        "edges",
      ),
    );
  }

  const walk = (
    starts: readonly string[],
    graph: ReadonlyMap<string, readonly string[]>,
  ): Set<string> => {
    const reached = new Set(starts);
    const pending = [...starts];
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) break;
      for (const next of graph.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          pending.push(next);
        }
      }
    }
    return reached;
  };
  const fromSources = walk(
    sources.map((node) => node.id),
    adjacency,
  );
  const toSinks = walk(
    sinks.map((node) => node.id),
    reverse,
  );
  expression.nodes.forEach((node, nodeIndex) => {
    if (!fromSources.has(node.id))
      diagnostics.push(
        diagnostic(
          "STR-015_NOT_REACHABLE_FROM_SOURCE",
          `Node is not reachable from a Source: ${node.id}`,
          `nodes[${String(nodeIndex)}]`,
          { nodeId: node.id },
        ),
      );
    if (node.kind !== "sink" && !toSinks.has(node.id))
      diagnostics.push(
        diagnostic(
          "STR-016_CANNOT_REACH_SINK",
          `Node cannot reach a Sink: ${node.id}`,
          `nodes[${String(nodeIndex)}]`,
          { nodeId: node.id },
        ),
      );
  });

  return diagnostics.length === 0
    ? { valid: true, diagnostics: [], topologicalOrder: order }
    : { valid: false, diagnostics };
}

export function assertValidRslStructure(
  expression: RslExpression,
): ValidStructure {
  const result = validateRslStructure(expression);
  if (!result.valid) throw new RslStructuralError(result.diagnostics);
  return result;
}
