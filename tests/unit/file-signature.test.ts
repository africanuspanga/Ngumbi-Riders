import { describe, it, expect } from 'vitest';
import {
  sniffFileType,
  fileSignatureMatches,
} from '@/lib/applications/file-signature';

const bytes = (...b: number[]) => new Uint8Array(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);

describe('sniffFileType', () => {
  it('detects png/pdf/jpeg from magic bytes', () => {
    expect(sniffFileType(PNG)).toBe('png');
    expect(sniffFileType(PDF)).toBe('pdf');
    expect(sniffFileType(JPEG)).toBe('jpeg');
  });
  it('returns null for unrecognised or short content', () => {
    expect(sniffFileType(bytes(0x00, 0x01, 0x02))).toBeNull();
    expect(sniffFileType(bytes())).toBeNull();
  });
});

describe('fileSignatureMatches', () => {
  it('accepts matching bytes + MIME', () => {
    expect(fileSignatureMatches(PNG, 'image/png')).toBe(true);
    expect(fileSignatureMatches(PDF, 'application/pdf')).toBe(true);
    expect(fileSignatureMatches(JPEG, 'image/jpeg')).toBe(true);
  });
  it('rejects a spoofed MIME type (png claiming to be pdf)', () => {
    expect(fileSignatureMatches(PNG, 'application/pdf')).toBe(false);
  });
  it('rejects an unrecognised/binary file (e.g. an .exe renamed)', () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00); // MZ header
    expect(fileSignatureMatches(exe, 'application/pdf')).toBe(false);
  });
  it('rejects an unsupported claimed MIME type', () => {
    expect(fileSignatureMatches(PNG, 'image/gif')).toBe(false);
  });
});
