import type { NonEmptyReadonlyArray, RslMapping } from "./value.js";
import type { TypeRef } from "./type-ref.js";

interface ReferenceBase<Kind extends string> {
  readonly kind: Kind;
  readonly ref: string;
  readonly version?: string;
}

export type OperationRef = ReferenceBase<"operation">;
export type WorkerRef = ReferenceBase<"worker">;
export type SchedulerRef = ReferenceBase<"scheduler">;
export type TypeContractRef = ReferenceBase<"type-contract">;

export type WorkerCategory =
  | "transformation"
  | "predicate"
  | "reducer"
  | "projection"
  | "observable-producing"
  | "effect";

export type WorkerPurity = "pure" | "effectful";

/** Optional declaration attached to a Worker reference before registry resolution. */
export interface WorkerContract {
  readonly category: WorkerCategory;
  readonly inputs: NonEmptyReadonlyArray<TypeRef>;
  readonly output: TypeRef;
  readonly purity: WorkerPurity;
}

export interface WorkerBinding {
  readonly worker: WorkerRef;
  /** Optional YAML-declared input contract; registry validation occurs later. */
  readonly input?: TypeRef;
  /** Optional YAML-declared return contract; registry validation occurs later. */
  readonly output?: TypeRef;
  readonly contract?: WorkerContract;
}

export interface SchedulerBinding {
  readonly scheduler: SchedulerRef;
}

/** Declarative operation configuration; it can contain no executable value. */
export type OperationParameters = RslMapping;
