import type { RegistryCategory } from "./types.js";

export type RegistryDiagnosticCode =
  | "REG-001_INVALID_REFERENCE"
  | "REG-002_DUPLICATE_DEFINITION"
  | "REG-003_MISSING_REFERENCE"
  | "REG-004_AMBIGUOUS_REFERENCE"
  | "REG-005_VERSION_MISMATCH"
  | "REG-006_WRONG_CATEGORY";

export interface RegistryDiagnostic {
  readonly code: RegistryDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly expectedCategory: RegistryCategory;
  readonly ref: string;
  readonly version?: string;
  readonly actualCategories?: readonly RegistryCategory[];
}

export class RslRegistryError extends Error {
  public override readonly name = "RslRegistryError";

  public constructor(
    public readonly diagnostics: readonly RegistryDiagnostic[],
  ) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `RSL reference resolution has ${String(diagnostics.length)} errors`,
    );
  }
}
