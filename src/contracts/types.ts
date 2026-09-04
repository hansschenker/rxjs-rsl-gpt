import type {
  RslValue,
  TypeRef,
  WorkerCategory,
  WorkerContract,
  WorkerPurity,
} from "../model/index.js";
import type { RegistryCategory } from "../registry/types.js";

export interface ArityContract {
  readonly min: number;
  readonly max: number;
}

export type ContractTypeTerm =
  | { readonly kind: "node-input"; readonly index: number }
  | { readonly kind: "node-output"; readonly index: number }
  | { readonly kind: "worker-input"; readonly index: number }
  | { readonly kind: "worker-output" }
  | { readonly kind: "type"; readonly type: TypeRef };

export interface TypeConstraint {
  readonly source: ContractTypeTerm;
  readonly target: ContractTypeTerm;
  readonly relation: "assignable" | "equal";
}

export interface WorkerRequirement {
  readonly required: boolean;
  readonly categories: readonly WorkerCategory[];
  readonly purity?: WorkerPurity;
  readonly inputArity?: ArityContract;
}

export interface ReducerRequirement {
  readonly seedParameter: string;
  readonly stateInput: number;
  readonly valueInput: number;
}

/** Declarative orchestration contract; contains no runtime implementation. */
export interface NodeOperationContract {
  readonly inputArity: ArityContract;
  readonly outputArity: ArityContract;
  readonly worker?: WorkerRequirement;
  readonly constraints?: readonly TypeConstraint[];
  readonly reducer?: ReducerRequirement;
}

/** Declarative named-type relation used by the assignable profile. */
export interface NamedTypeContract {
  readonly assignableTo?: readonly string[];
}

export type RegistryContract<Category extends RegistryCategory> =
  Category extends "source" | "operation" | "sink"
    ? NodeOperationContract
    : Category extends "worker"
      ? WorkerContract
      : Category extends "type"
        ? NamedTypeContract
        : never;

export type TypeCompatibilityProfile = "exact" | "assignable";

export interface SemanticValidationOptions {
  readonly profile?: TypeCompatibilityProfile;
}

function isRslArray(value: RslValue): value is readonly RslValue[] {
  return Array.isArray(value);
}

export function inferRslValueType(value: RslValue): TypeRef {
  if (value === null) return { kind: "primitive", name: "null" };
  if (typeof value === "boolean") return { kind: "primitive", name: "boolean" };
  if (typeof value === "number") return { kind: "primitive", name: "number" };
  if (typeof value === "string") return { kind: "primitive", name: "string" };
  if (isRslArray(value)) {
    return {
      kind: "tuple",
      items: value.map((item) => inferRslValueType(item)),
    };
  }
  return {
    kind: "record",
    fields: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        inferRslValueType(item),
      ]),
    ),
  };
}
