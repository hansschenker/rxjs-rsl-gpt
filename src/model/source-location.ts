export interface SourcePosition {
  /** One-based line number. */
  readonly line: number;
  /** One-based Unicode code-point column. */
  readonly column: number;
  /** Zero-based UTF-16 offset in the decoded source text. */
  readonly offset: number;
}

export interface SourceLocation {
  readonly source: string;
  readonly start: SourcePosition;
  readonly end?: SourcePosition;
}

export interface Located {
  /** Non-semantic origin retained for diagnostics and tooling. */
  readonly location?: SourceLocation;
}
