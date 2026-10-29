import { error } from "@sveltejs/kit";

/** Bound actual streamed bytes, including requests with no Content-Length header. */
export async function readBody(
  request: Request,
  maximum: number,
): Promise<Buffer<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return Buffer.concat(chunks);
    size += chunk.value.length;
    if (size > maximum) {
      await reader.cancel();
      error(
        413,
        "This request exceeds the size limit. Choose a smaller file or draft.",
      );
    }
    chunks.push(chunk.value);
  }
}
