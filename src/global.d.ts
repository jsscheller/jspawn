declare module "worker:*" {
  const value: string;
  export default value;
}

declare module "*.wasm" {
  const value: Uint8Array;
  export default value;
}
