// Unit-test platform boundary only. Production still resolves Obsidian itself.
export class TFile { constructor(public path: string) {} }
export const normalizePath = (path: string): string => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
export class Vault {}
