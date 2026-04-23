/**
 * Hex-encoded SHA-256 using WebCrypto (native in Workers).
 */
export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
