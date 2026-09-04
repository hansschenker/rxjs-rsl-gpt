import type { RslExpression } from "../model/index.js";
import { normalizeRslDocument } from "./schema.js";
import { parseRslYamlValue } from "./value-parser.js";

export { RslYamlError, type RslYamlErrorCode } from "./error.js";
export { normalizeRslDocument, normalizeTypeRef } from "./schema.js";
export { parseRslYamlValue } from "./value-parser.js";
export {
  expressionToRslValue,
  stringifyRslExpression,
  stringifyRslYamlValue,
} from "./writer.js";

export function parseRslExpression(source: string): RslExpression {
  return normalizeRslDocument(parseRslYamlValue(source));
}
