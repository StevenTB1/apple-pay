export const MAX_REQUEST_BYTES = 32 * 1024;

function reject(message: string, status: number) {
  return Response.json({ errors: [{ message }] }, { status });
}

// Read the actual stream with a bound; Content-Length alone cannot constrain
// chunked requests or a caller's incorrect header.
export async function boundGraphQLRequest(request: Request): Promise<Request | Response> {
  if (request.url.length > 8192) return reject("Request URL is too large.", 414);
  if (request.method !== "POST") return request;
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return reject("GraphQL POST requests must use application/json.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    return reject("Request body is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return reject("A JSON request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return reject("Request body is too large.", 413);
      }
      chunks.push(chunk.value);
    }
  } catch {
    return reject("Could not read the request body.", 400);
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}
