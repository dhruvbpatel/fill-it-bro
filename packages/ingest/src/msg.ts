import { extname } from 'node:path';
import MsgReaderImport from '@kenjiuno/msgreader';

// tsconfig targets real ESM (module: ESNext); Node's CJS interop binds the default
// import to the whole `module.exports` object for CJS packages like this one, not to
// `module.exports.default`. Unwrap explicitly rather than relying on a bundler's
// esModuleInterop rewrite, which never runs for an ESNext build.
const MsgReader =
  (MsgReaderImport as unknown as { default?: typeof MsgReaderImport }).default ?? MsgReaderImport;

export interface MsgAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ParsedMsg {
  bodyHtml: string | null;
  bodyText: string;
  attachments: MsgAttachment[];
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function mimeFor(name: string, attachMimeTag: string | undefined): string {
  if (attachMimeTag) return attachMimeTag.split(';')[0]!.trim();
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function parseMsg(bytes: Uint8Array): ParsedMsg {
  const reader = new MsgReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const data = reader.getFileData();
  const attachments = (data.attachments ?? [])
    .filter((att) => !att.innerMsgContent)
    .map((att) => {
      const name = att.fileName ?? att.fileNameShort ?? 'attachment';
      return {
        name,
        mime: mimeFor(name, att.attachMimeTag),
        bytes: reader.getAttachment(att).content,
      };
    });
  return {
    bodyHtml: data.bodyHtml ?? null,
    bodyText: data.body ?? '',
    attachments,
  };
}
