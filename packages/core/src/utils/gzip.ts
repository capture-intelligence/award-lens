/**
 * Gzip compression using CompressionStream (native in Workers).
 */
export async function gzip(input: string | ArrayBuffer): Promise<ArrayBuffer> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const stream = new Response(data).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export async function gunzipText(input: ArrayBuffer): Promise<string> {
  const stream = new Response(input).body!.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
