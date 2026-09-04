/**
 * JSON-compatible value model produced by deterministic RSL YAML parsing.
 * Runtime objects, functions, symbols, undefined, and cyclic structures are
 * intentionally absent.
 */
export type RslValue =
  null | boolean | number | string | readonly RslValue[] | RslMapping;

export interface RslMapping {
  readonly [key: string]: RslValue;
}

/** Non-empty ordered collection used for node port cardinalities. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
