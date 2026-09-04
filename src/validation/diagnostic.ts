export type StructuralDiagnosticCode =
  | "STR-001_INVALID_LOCAL_ID"
  | "STR-002_DUPLICATE_NODE_ID"
  | "STR-003_DUPLICATE_PORT_ID"
  | "STR-004_MISSING_SOURCE"
  | "STR-005_MISSING_SINK"
  | "STR-006_INVALID_NODE_POLARITY"
  | "STR-007_INVALID_EDGE_DIRECTION"
  | "STR-008_UNKNOWN_EDGE_NODE"
  | "STR-009_UNKNOWN_EDGE_PORT"
  | "STR-010_DUPLICATE_EDGE"
  | "STR-011_UNCONNECTED_INPUT"
  | "STR-012_MULTIPLE_INPUT_EDGES"
  | "STR-013_UNUSED_OUTPUT"
  | "STR-014_CYCLE"
  | "STR-015_NOT_REACHABLE_FROM_SOURCE"
  | "STR-016_CANNOT_REACH_SINK";

export interface StructuralDiagnostic {
  readonly code: StructuralDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly nodeId?: string;
  readonly portId?: string;
  readonly edgeIndex?: number;
}
