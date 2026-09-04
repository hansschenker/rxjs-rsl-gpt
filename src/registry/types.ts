import type { RslExpression, RslNode, TypeRef } from "../model/index.js";
import type { RegistryContract } from "../contracts/types.js";

export type RegistryCategory =
  "source" | "operation" | "sink" | "worker" | "scheduler" | "type";

export interface RegistryDefinition<
  Category extends RegistryCategory = RegistryCategory,
  Value = unknown,
> {
  readonly category: Category;
  readonly ref: string;
  readonly version?: string;
  /** Runtime-owned capability. Resolution returns it but never invokes it. */
  readonly value: Value;
  /** Declarative semantics checked without invoking `value`. */
  readonly contract?: RegistryContract<Category>;
}

export interface RslRegistry<
  Category extends RegistryCategory = RegistryCategory,
  Value = unknown,
> {
  readonly category: Category;
  readonly definitions: readonly RegistryDefinition<Category, Value>[];
}

export interface RslRegistries {
  readonly sources: RslRegistry<"source">;
  readonly operations: RslRegistry<"operation">;
  readonly sinks: RslRegistry<"sink">;
  readonly workers: RslRegistry<"worker">;
  readonly schedulers: RslRegistry<"scheduler">;
  readonly types: RslRegistry<"type">;
}

export interface ResolvedReference<
  Category extends RegistryCategory = RegistryCategory,
> {
  readonly category: Category;
  readonly ref: string;
  readonly requestedVersion?: string;
  readonly definition: RegistryDefinition<Category>;
}

export interface ResolvedNode {
  readonly node: RslNode;
  readonly operation: ResolvedReference<"source" | "operation" | "sink">;
  readonly worker?: ResolvedReference<"worker">;
  readonly scheduler?: ResolvedReference<"scheduler">;
}

export interface ResolvedTypeReference {
  readonly path: string;
  readonly type: Extract<TypeRef, { readonly kind: "named" | "generic" }>;
  readonly definition: RegistryDefinition<"type">;
}

export interface ResolvedRslExpression {
  readonly expression: RslExpression;
  readonly nodes: readonly ResolvedNode[];
  readonly types: readonly ResolvedTypeReference[];
}
