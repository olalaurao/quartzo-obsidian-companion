import { ObjectParser } from '../objects';

export interface MergeReferenceObject {
  id: string;
  path: string;
  markdown: string;
}

function normalizeTarget(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .toLocaleLowerCase();
}

export function mergeReferenceKeys(object: MergeReferenceObject): Set<string> {
  const parsed = ObjectParser.parseMarkdown(object.markdown);
  const keys = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) keys.add(normalizeTarget(value));
  };
  add(object.id);
  add(parsed.frontmatter.id);
  add(parsed.frontmatter.title);
  add(parsed.frontmatter.slug);
  add(object.path);
  add(object.path.replace(/\.md$/i, '').split(/[\\/]/).pop());
  add(parsed.frontmatter.type && parsed.frontmatter.slug
    ? `${parsed.frontmatter.type}/${parsed.frontmatter.slug}`
    : undefined);
  const aliases = parsed.frontmatter.aliases;
  if (Array.isArray(aliases)) aliases.forEach(add);
  else add(aliases);
  return keys;
}

/** Rewrites exact WikiLink targets while retaining headings and display labels. */
export function rewriteMergeWikiLinks(
  markdown: string,
  sourceKeys: Set<string>,
  survivorPath: string,
): string {
  const destination = survivorPath.replace(/\\/g, '/').replace(/\.md$/i, '');
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const separator = inner.indexOf('|');
    const rawTarget = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
    const suffix = separator >= 0 ? inner.slice(separator) : '';
    const anchorIndex = rawTarget.indexOf('#');
    const target = anchorIndex >= 0 ? rawTarget.slice(0, anchorIndex) : rawTarget;
    const anchor = anchorIndex >= 0 ? rawTarget.slice(anchorIndex) : '';
    const normalizedTarget = normalizeTarget(target);
    const leaf = normalizeTarget(target.split('/').pop() ?? target);
    if (!sourceKeys.has(normalizedTarget) && !sourceKeys.has(leaf)) return whole;
    return `[[${destination}${anchor}${suffix}]]`;
  });
}
