declare module "openapi-to-postmanv2" {
  type ConversionResult = { result: boolean; reason?: string; output?: Array<{ data: Record<string, unknown> }> };
  type ConversionInput = { type: "json"; data: Record<string, unknown> };
  const converter: {
    convert(
      input: ConversionInput,
      options: Record<string, unknown>,
      callback: (error: Error | null, result: ConversionResult) => void
    ): void;
  };
  export default converter;
}
