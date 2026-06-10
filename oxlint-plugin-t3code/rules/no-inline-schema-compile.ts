import { defineRule } from "@oxlint/plugins";

import { getPropertyName, isIdentifier, unwrapExpression } from "../utils.ts";

// Effect Schema decoder/encoder APIs allocate compiled functions. Keep them
// outside function bodies so hot paths do not rebuild compilers per call.
const COMPILER_METHODS = new Set<string>([
  "is",
  "asserts",
  "decodeEffect",
  "decodeExit",
  "decodeOption",
  "decodePromise",
  "decodeSync",
  "decodeUnknownExit",
  "decodeUnknownEffect",
  "decodeUnknownOption",
  "decodeUnknownPromise",
  "decodeUnknownSync",

  "encodeExit",
  "encodeEffect",
  "encodeOption",
  "encodePromise",
  "encodeSync",
  "encodeUnknownExit",
  "encodeUnknownEffect",
  "encodeUnknownOption",
  "encodeUnknownPromise",
  "encodeUnknownSync",
]);

const getSchemaCompilerMethod = (callee: unknown): string | null => {
  const expression = unwrapExpression(callee);
  if (!expression || expression.type !== "MemberExpression") {
    return null;
  }

  const object = unwrapExpression(expression.object);
  if (!isIdentifier(object, "Schema")) return null;

  const method = getPropertyName(expression.property);
  return method !== null && COMPILER_METHODS.has(method) ? method : null;
};

const isStaticSchemaReference = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (!expression) return false;

  if (expression.type === "Identifier") {
    const [firstChar] = expression.name;
    return firstChar !== undefined && firstChar.toUpperCase() === firstChar;
  }

  return expression.type === "MemberExpression";
};

const isNestedStaticSchemaCall = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (!expression || expression.type !== "CallExpression") return false;

  const callee = unwrapExpression(expression.callee);
  if (!callee || callee.type !== "MemberExpression") return false;

  const object = unwrapExpression(callee.object);
  if (!isIdentifier(object, "Schema")) return false;

  const method = getPropertyName(callee.property);
  if (method === "fromJsonString") {
    const firstArg = expression.arguments[0];
    return isStaticSchemaReference(firstArg) || isNestedStaticSchemaCall(firstArg);
  }

  return true;
};

const isImmediatelyInvoked = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (!expression) return false;

  const parent = "parent" in expression ? unwrapExpression(expression.parent) : null;
  return (
    parent !== null &&
    parent.type === "CallExpression" &&
    unwrapExpression(parent.callee) === expression
  );
};

const messageHigh = (method: string) =>
  `Hoist Schema.${method}(...) to module scope: both the inline schema literal and the compiled function are rebuilt on every call. Move the compiled function to a module-level const.`;

const messageMedium = (method: string) =>
  `Hoist Schema.${method}(...) to module scope: the compiled function is rebuilt on every call. Move it to a module-level const.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Schema decoder/encoder compiler calls inside function bodies; hoist them to module scope.",
    },
  },
  createOnce(context) {
    let functionDepth = 0;

    const resetFunctionDepth = () => {
      functionDepth = 0;
    };

    const enterFunction = () => {
      functionDepth++;
    };

    const exitFunction = () => {
      functionDepth--;
    };

    return {
      before: resetFunctionDepth,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      CallExpression(node) {
        if (functionDepth === 0) return;

        const method = getSchemaCompilerMethod(node.callee);
        if (method === null) return;
        if (!isImmediatelyInvoked(node)) return;

        const firstArg = node.arguments[0];
        const high = firstArg && isNestedStaticSchemaCall(firstArg);
        if (!high && !isStaticSchemaReference(firstArg)) return;

        context.report({
          node: node.callee,
          message: high ? messageHigh(method) : messageMedium(method),
        });
      },
    };
  },
});
