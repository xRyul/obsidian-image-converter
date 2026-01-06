export interface Mime {
  getType(path: string): string | null;
  getExtension(type: string): string | null;
  getAllExtensions(type: string): Set<string> | null;
}

declare const mime: Mime;
export default mime;
