declare module "lz4js" {
  export interface Lz4Js {
    readonly compress: (
      buffer: ReadonlyArray<number> | Uint8Array,
      maxSize?: number,
    ) => Uint8Array;
    readonly decompress: (
      buffer: ReadonlyArray<number> | Uint8Array,
      maxSize?: number,
    ) => Uint8Array;
    readonly compressBound: (inputSize: number) => number;
    readonly decompressBound: (
      buffer: ReadonlyArray<number> | Uint8Array,
    ) => number;
  }

  const lz4: Lz4Js;
  export default lz4;
}
