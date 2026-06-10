import { pathToFileURL } from "node:url";

export function isDirectlyExecuted(metaUrl: string): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? metaUrl === pathToFileURL(entrypoint).href : false;
}
