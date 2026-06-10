import type { ESTree } from "@oxlint/plugins";

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion;

type AstNode = ESTree.Node;

const asAstNode = (node: unknown): AstNode | null =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
    ? (node as AstNode)
    : null;

const isExpressionWrapper = (node: AstNode): node is ExpressionWrapper =>
  node.type === "ChainExpression" ||
  node.type === "ParenthesizedExpression" ||
  node.type === "TSNonNullExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSTypeAssertion";

export function unwrapExpression(node: unknown): AstNode | null {
  let current = asAstNode(node);

  while (current && isExpressionWrapper(current)) {
    current = asAstNode(current.expression);
  }

  return current;
}

export function getPropertyName(node: unknown): string | null {
  const expression = asAstNode(node);
  if (!expression) return null;
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    return expression.name;
  }
  if (expression.type === "PrivateIdentifier" && typeof expression.name === "string") {
    return expression.name;
  }
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  return null;
}

export function isIdentifier(node: AstNode | null, name?: string): boolean {
  if (!node) return false;
  return (
    node.type === "Identifier" &&
    typeof node.name === "string" &&
    (name === undefined || node.name === name)
  );
}
