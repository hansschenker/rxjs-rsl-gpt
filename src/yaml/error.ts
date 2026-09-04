export type RslYamlErrorCode =
  | "invalid-encoding"
  | "forbidden-syntax"
  | "invalid-scalar"
  | "duplicate-key"
  | "invalid-document"
  | "invalid-schema";

export class RslYamlError extends Error {
  public override readonly name = "RslYamlError";

  public constructor(
    public readonly code: RslYamlErrorCode,
    message: string,
  ) {
    super(message);
  }
}
