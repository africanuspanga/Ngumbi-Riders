/*
 * Magic-byte file-type sniffing (spec §8.6, §24: "validate extension, MIME type
 * AND file signature"). A malicious client can lie about a file's MIME type and
 * extension, so before storing we confirm the actual leading bytes match one of
 * the accepted formats. Pure and dependency-free for unit testing.
 */
export type SniffedType = 'pdf' | 'png' | 'jpeg';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/** Returns the true type from the leading bytes, or null if unrecognised. */
export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'png';
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, JPEG_MAGIC)) return 'jpeg';
  return null;
}

// Maps the claimed MIME type to the signature we expect to find.
const MIME_TO_TYPE: Record<string, SniffedType> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
};

/**
 * True when the real bytes match the claimed MIME type. Rejects spoofed files
 * (e.g. an .exe renamed to .pdf, or an unrecognised binary).
 */
export function fileSignatureMatches(
  bytes: Uint8Array,
  claimedMime: string,
): boolean {
  const expected = MIME_TO_TYPE[claimedMime];
  if (!expected) return false;
  return sniffFileType(bytes) === expected;
}
