export type SemanticDiagnosticCode =
  | "TYP-001_INCOMPATIBLE_EDGE"
  | "TYP-002_MISSING_OPERATION_CONTRACT"
  | "TYP-003_OPERATION_ARITY"
  | "TYP-004_UNEXPECTED_WORKER"
  | "TYP-005_MISSING_WORKER"
  | "TYP-006_MISSING_WORKER_CONTRACT"
  | "TYP-007_WORKER_CATEGORY"
  | "TYP-008_WORKER_PURITY"
  | "TYP-009_WORKER_ARITY"
  | "TYP-010_CONTRACT_CONSTRAINT"
  | "TYP-011_DECLARED_WORKER_TYPE"
  | "TYP-012_MISSING_REDUCER_SEED"
  | "TYP-013_REDUCER_SEED_TYPE";

export interface SemanticDiagnostic {
  readonly code: SemanticDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly nodeId?: string;
  readonly edgeIndex?: number;
}

export class RslSemanticError extends Error {
  public override readonly name = "RslSemanticError";

  public constructor(
    public readonly diagnostics: readonly SemanticDiagnostic[],
  ) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `RSL semantic validation has ${String(diagnostics.length)} errors`,
    );
  }
}
