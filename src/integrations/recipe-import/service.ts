import {
  extractCommonHtmlMetadata,
  extractJsonLdNodes,
  type LinkCaptureMetadata,
} from '../../core/link-capture/policy';
import {
  remoteResponseText,
  secureRemoteFetch,
  type RemoteFetchResponse,
} from '../../platform/remote-fetch-security';

export interface RecipeImportDraft extends LinkCaptureMetadata {
  sourceName?: string;
  servings?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  ingredients: string[];
  instructions: string[];
  notes?: string;
  warnings: string[];
}

export type RecipeImportFetcher = (url: string) => Promise<RemoteFetchResponse>;

export class RecipeImportService {
  constructor(private readonly fetcher: RecipeImportFetcher = RecipeImportService.defaultFetcher) {}

  static defaultFetcher(url: string): Promise<RemoteFetchResponse> {
    return secureRemoteFetch(url, {
      policy: {
        allowedSchemes: new Set(['https']),
        maxBytes: 2 * 1024 * 1024,
        allowedContentTypePrefixes: ['text/html', 'application/xhtml+xml'],
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuartzoCompanion/1.0)',
        'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
      },
    });
  }

  async importUrl(url: string): Promise<RecipeImportDraft> {
    try {
      const response = await this.fetcher(url);
      const html = remoteResponseText(response);
      return this.extractFromHtml(html, response.uri.toString());
    } catch (error) {
      return {
        sourceUrl: url,
        resolvedUrl: url,
        title: fallbackTitleFromUrl(url, 'Recipe'),
        ingredients: [],
        instructions: [],
        warnings: [
          error instanceof Error
            ? error.message
            : 'Automatic metadata was not available. You can still save this link manually.',
        ],
      };
    }
  }

  extractFromHtml(html: string, pageUrl: string): RecipeImportDraft {
    const common = extractCommonHtmlMetadata(html, pageUrl);
    for (const node of extractJsonLdNodes(html)) {
      if (!schemaTypes(node['@type']).some(type => type.toLowerCase() === 'recipe')) continue;
      const ingredients = arrayText(node.recipeIngredient);
      const instructions = recipeInstructions(node.recipeInstructions);
      return {
        ...common,
        title: textValue(node.name) ?? common.title ?? fallbackTitleFromUrl(pageUrl, 'Recipe'),
        imageUrl: safeImage(node.image, pageUrl) ?? common.imageUrl,
        sourceName: textValue(node.author) ?? common.siteName,
        servings: textValue(node.recipeYield),
        prepTimeMinutes: parseIsoDurationMinutes(textValue(node.prepTime)),
        cookTimeMinutes: parseIsoDurationMinutes(textValue(node.cookTime)),
        totalTimeMinutes: parseIsoDurationMinutes(textValue(node.totalTime)),
        description: textValue(node.description) ?? common.description,
        ingredients,
        instructions,
        warnings: [
          ...(ingredients.length === 0 ? ['Ingredients could not be fully detected.'] : []),
          ...(instructions.length === 0 ? ['Some steps may need review.'] : []),
        ],
      };
    }
    return {
      ...common,
      title: common.title ?? fallbackTitleFromUrl(pageUrl, 'Recipe'),
      sourceName: common.siteName,
      ingredients: [],
      instructions: [],
      warnings: ['Automatic metadata was not available. You can still save this link manually.'],
    };
  }
}

export function buildRecipeBody(draft: Pick<RecipeImportDraft, 'description' | 'ingredients' | 'instructions' | 'notes'>): string {
  const lines: string[] = ['<!-- quartzo:recipe:v1 -->', ''];
  if (draft.description?.trim()) {
    lines.push(draft.description.trim(), '');
  }
  lines.push('<!-- quartzo:recipe:ingredients -->', '## Ingredients', '');
  lines.push(...(draft.ingredients.length > 0 ? draft.ingredients.map(item => `- ${item}`) : ['']));
  lines.push('', '<!-- quartzo:recipe:instructions -->', '## Instructions', '');
  lines.push(...(draft.instructions.length > 0 ? draft.instructions.map((item, index) => `${index + 1}. ${item}`) : ['']));
  lines.push('', '<!-- quartzo:recipe:notes -->', '## Notes', '');
  if (draft.notes?.trim()) lines.push(draft.notes.trim());
  return lines.join('\n').trimEnd();
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(item => String(item));
  return [];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textValue(record.name) ?? textValue(record.text) ?? textValue(record.url);
  }
  return undefined;
}

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(textValue).filter((item): item is string => Boolean(item));
}

function recipeInstructions(value: unknown): string[] {
  if (typeof value === 'string') return [clean(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(recipeInstructions);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const type = schemaTypes(record['@type']).join(' ').toLowerCase();
    const out: string[] = [];
    if (type.includes('howtosection') && textValue(record.name)) out.push(`### ${textValue(record.name)}`);
    const text = type.includes('howtosection') ? undefined : (textValue(record.text) ?? textValue(record.name));
    if (text) out.push(text);
    return [...out, ...recipeInstructions(record.itemListElement)];
  }
  return [];
}

function safeImage(value: unknown, base: string): string | undefined {
  const raw = textValue(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseIsoDurationMinutes(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return undefined;
  const minutes = (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : undefined;
}

function fallbackTitleFromUrl(url: string, fallback: string): string {
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}
