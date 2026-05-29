declare module "to-ico" {
  import type { Buffer } from "node:buffer";

  export default function toIco(input: readonly Buffer[]): Promise<Buffer>;
}
