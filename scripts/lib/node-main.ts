import * as NodeURL from "node:url";

export function isDirectlyExecuted(metaUrl: string): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? metaUrl === NodeURL.pathToFileURL(entrypoint).href : false;
}
