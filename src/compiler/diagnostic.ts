export type CompilerDiagnosticCode =
  | "CMP-001_UNSUPPORTED_TOPOLOGY"
  | "CMP-002_INVALID_CAPABILITY"
  | "CMP-003_INVALID_WORKER"
  | "CMP-004_UNSUPPORTED_PORT_SHAPE";

export class RslCompilerError extends Error {
  public override readonly name = "RslCompilerError";

  public constructor(
    public readonly code: CompilerDiagnosticCode,
    message: string,
    public readonly nodeId?: string,
  ) {
    super(message);
  }
}
