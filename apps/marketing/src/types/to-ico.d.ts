declare module "to-ico" {
  import type * as NodeBuffer from "node:buffer";

  export default function toIco(input: readonly NodeBuffer.Buffer[]): Promise<NodeBuffer.Buffer>;
}
