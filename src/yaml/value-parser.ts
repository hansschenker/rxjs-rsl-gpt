import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Scalar,
} from "yaml";

import type { RslValue } from "../model/index.js";
import { RslYamlError } from "./error.js";

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
const INTEGER = /^-?(?:0|[1-9]\d*)$/u;
const SAFE_PLAIN = /^[A-Za-z_][A-Za-z0-9_.:/-]*$/u;
const RESERVED_WORD = /^(?:true|false|null|yes|no|on|off)$/iu;

function rejectLexicalSyntax(source: string): void {
  if (source.startsWith("\uFEFF")) {
    throw new RslYamlError("invalid-encoding", "A UTF-8 BOM is forbidden");
  }
  if (source.includes("\r")) {
    throw new RslYamlError(
      "invalid-encoding",
      "Only LF line endings are accepted",
    );
  }
  if (!source.endsWith("\n")) {
    throw new RslYamlError("invalid-encoding", "Input must end with one LF");
  }

  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "\t") {
      throw new RslYamlError(
        "forbidden-syntax",
        "Tabs are forbidden outside strings",
      );
    }
  }

  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:---|\.\.\.)(?:\s|$)/u.test(line) || /^\s*%/u.test(line)) {
      throw new RslYamlError(
        "forbidden-syntax",
        "YAML markers and directives are forbidden",
      );
    }
    if (/^\s*[^#\n]+:\s*(?:#.*)?$/u.test(line)) {
      const indentation = line.search(/\S/u);
      const next = lines
        .slice(index + 1)
        .find((candidate) => !/^\s*(?:#.*)?$/u.test(candidate));
      if (next === undefined || next.search(/\S/u) <= indentation) {
        throw new RslYamlError(
          "invalid-scalar",
          "Empty mapping values are forbidden",
        );
      }
    }
  }
}

function validatePlainScalar(node: Scalar): void {
  const source = node.source ?? "";
  if (source === "null" || source === "true" || source === "false") return;
  if (JSON_NUMBER.test(source)) {
    const value = Number(source);
    if (!Number.isFinite(value)) {
      throw new RslYamlError("invalid-scalar", `Non-finite number: ${source}`);
    }
    if (INTEGER.test(source) && !Number.isSafeInteger(value)) {
      throw new RslYamlError("invalid-scalar", `Unsafe integer: ${source}`);
    }
    return;
  }
  if (!SAFE_PLAIN.test(source) || RESERVED_WORD.test(source)) {
    throw new RslYamlError(
      "invalid-scalar",
      `Plain scalar must be quoted: ${source}`,
    );
  }
}

export function parseRslYamlValue(source: string): RslValue {
  rejectLexicalSyntax(source);
  const document = parseDocument(source, {
    merge: false,
    prettyErrors: false,
    schema: "core",
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const duplicate = document.errors.some((error) =>
      /Map keys must be unique/u.test(error.message),
    );
    throw new RslYamlError(
      duplicate ? "duplicate-key" : "invalid-document",
      document.errors[0]?.message ?? "Invalid YAML",
    );
  }
  if (document.contents === null) {
    throw new RslYamlError(
      "invalid-document",
      "The document must contain one value",
    );
  }

  visit(document, (_key, node) => {
    if (
      isAlias(node) ||
      ((isMap(node) || isSeq(node) || isScalar(node)) &&
        (node.anchor !== undefined || node.tag !== undefined))
    ) {
      throw new RslYamlError(
        "forbidden-syntax",
        "Aliases, anchors, and tags are forbidden",
      );
    }
    if (isMap(node) && node.flow) {
      throw new RslYamlError(
        "forbidden-syntax",
        "Flow-style mappings are forbidden",
      );
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
          throw new RslYamlError(
            "invalid-document",
            "Mapping keys must be strings",
          );
        }
      }
    }
    if (isScalar(node)) {
      if (
        node.type === "QUOTE_SINGLE" ||
        node.type === "BLOCK_LITERAL" ||
        node.type === "BLOCK_FOLDED"
      ) {
        throw new RslYamlError(
          "forbidden-syntax",
          "Only plain and double-quoted scalars are accepted",
        );
      }
      if (node.type === "PLAIN") validatePlainScalar(node);
      if (
        node.type === "QUOTE_DOUBLE" &&
        node.range !== undefined &&
        node.range !== null
      ) {
        const raw = source.slice(node.range[0], node.range[1]);
        try {
          JSON.parse(raw);
        } catch {
          throw new RslYamlError(
            "invalid-scalar",
            "Double-quoted strings must use JSON escapes",
          );
        }
      }
      if (typeof node.value === "number" && Object.is(node.value, -0))
        node.value = 0;
    }
    if (
      isSeq(node) &&
      node.flow &&
      node.range !== undefined &&
      node.range !== null &&
      /,\s*\]$/u.test(source.slice(node.range[0], node.range[1]))
    ) {
      throw new RslYamlError(
        "forbidden-syntax",
        "Trailing sequence commas are forbidden",
      );
    }
  });

  const value: unknown = document.toJS({ mapAsMap: false, maxAliasCount: 0 });
  return normalizeValue(value);
}

function normalizeValue(value: unknown): RslValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return typeof value === "string" ? value.normalize("NFC") : value;
  }
  if (typeof value === "number" && Number.isFinite(value))
    return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    const result: Record<string, RslValue> = {};
    for (const [rawKey, item] of Object.entries(value)) {
      const key = rawKey.normalize("NFC");
      if (Object.hasOwn(result, key)) {
        throw new RslYamlError(
          "duplicate-key",
          `Duplicate key after NFC normalization: ${key}`,
        );
      }
      result[key] = normalizeValue(item);
    }
    return result;
  }
  throw new RslYamlError("invalid-document", "YAML produced a non-RSL value");
}
