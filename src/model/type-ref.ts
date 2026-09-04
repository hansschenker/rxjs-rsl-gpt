import type { NonEmptyReadonlyArray } from "./value.js";

export type PrimitiveTypeName =
  "string" | "number" | "boolean" | "null" | "unknown" | "never" | "void";

export interface PrimitiveTypeRef {
  readonly kind: "primitive";
  readonly name: PrimitiveTypeName;
}

export interface NamedTypeRef {
  readonly kind: "named";
  readonly ref: string;
}

export interface ArrayTypeRef {
  readonly kind: "array";
  readonly items: TypeRef;
}

export interface TupleTypeRef {
  readonly kind: "tuple";
  readonly items: readonly TypeRef[];
}

export interface RecordTypeRef {
  readonly kind: "record";
  readonly fields: Readonly<Record<string, TypeRef>>;
}

export interface UnionTypeRef {
  readonly kind: "union";
  readonly members: NonEmptyReadonlyArray<TypeRef>;
}

export interface GenericTypeRef {
  readonly kind: "generic";
  readonly ref: string;
  readonly arguments: readonly TypeRef[];
}

/** Return contract of an Observable-producing Worker. */
export interface ObservableTypeRef {
  readonly kind: "observable";
  readonly value: TypeRef;
}

/** Fully normalized TypeRef; scalar YAML shorthand does not survive here. */
export type TypeRef =
  | PrimitiveTypeRef
  | NamedTypeRef
  | ArrayTypeRef
  | TupleTypeRef
  | RecordTypeRef
  | UnionTypeRef
  | GenericTypeRef
  | ObservableTypeRef;

/**
 * Top-level TypeRefs carried by dataflow ports. `void` is reserved for Worker
 * returns and `observable` describes a Worker return, not a value notification.
 * Recursive semantic restrictions are validated in RSL 10.
 */
export type PortTypeRef =
  | {
      readonly kind: "primitive";
      readonly name: Exclude<PrimitiveTypeName, "void">;
    }
  | NamedTypeRef
  | ArrayTypeRef
  | TupleTypeRef
  | RecordTypeRef
  | UnionTypeRef
  | GenericTypeRef;
