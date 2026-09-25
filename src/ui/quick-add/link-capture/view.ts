import { Notice, TFile } from 'obsidian';
import { buildQuickAddDocument, type QuickAddType } from '../../../core/object-creation';
import { findRecipeDuplicates, findSocialPostDuplicates } from '../../../core/link-capture/duplicate-policy';
import {
  applyUserLinkSelection,
  mergePristineMetadata,
  suggestLinkFromUrl,
  type LinkCaptureDestination,
  type LinkCaptureMetadata,
  type LinkCaptureSuggestion,
} from '../../../core/link-capture/policy';
import { findResourceDuplicates, type ResourceIdentity } from '../../../core/resource-capture/policy';
import { ResourceMetadataService } from '../../../integrations/resource-metadata/service';
import { buildRecipeBody, RecipeImportService, type RecipeImportDraft } from '../../../integrations/recipe-import/service';
import { SocialMetadataService, type SocialMetadataDraft } from '../../../integrations/social-metadata/service';
import { createCanonicalObjectId } from '../../../platform/object-id';
import type { SharedSettingsRepository } from '../../../vault/shared-settings';
import type { IndexedObject, VaultIndex } from '../../../vault/index/types';
import { queryVaultObjects } from '../../../core/object-query';
import type { ViewContext } from '../../types';

const RESOURCE_TYPES = ['General', 'Book', 'Movie', 'Show', 'Video', 'Podcast', 'Article', 'Course'];

export interface LinkCaptureRendererOptions {
  settingsRepository: SharedSettingsRepository;
  getIndex(): VaultIndex | null;
  ensureParentFolders(path: string): Promise<void>;
  openIndexedObject(object: IndexedObject): Promise<void>;
  onCreated?(created: { id: string; type: QuickAddType; path: string }): void | Promise<void>;
  close(): void;
  back(): void;
}

export function renderLinkCaptureQuickAdd(
  container: HTMLElement,
  context: ViewContext,
  options: LinkCaptureRendererOptions,
): void {
  const resourceMetadataService = new ResourceMetadataService();
  const recipeImportService = new RecipeImportService();
  const socialMetadataService = new SocialMetadataService();
  let suggested: LinkCaptureSuggestion | null = null;
  let selected: LinkCaptureSuggestion | null = null;
  let common: LinkCaptureMetadata = {};
  let recipeDraft: RecipeImportDraft | null = null;
  let socialDraft: SocialMetadataDraft | null = null;
  let resourceMetadata: Awaited<ReturnType<ResourceMetadataService['fetch']>> | null = null;
  const dirty = new Set<string>();

  const render = (): void => {
    container.empty();
    const title = document.createElement('h2');
    title.textContent = 'Save link';
    container.appendChild(title);

    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Quick Add';
    back.addEventListener('click', options.back);
    container.appendChild(back);

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'Paste a link';
    urlInput.className = 'quartzo-input';
    urlInput.value = common.sourceUrl ?? '';
    container.appendChild(urlInput);

    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.appendChild(status);

    const analyze = document.createElement('button');
    analyze.type = 'button';
    analyze.textContent = 'Analyze';
    analyze.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        status.textContent = 'Paste a link first.';
        return;
      }
      common = { ...common, sourceUrl: url, resolvedUrl: url };
      analyze.disabled = true;
      analyze.textContent = 'Analyzing link...';
      status.textContent = 'Analyzing link...';
      try {
        suggested = suggestLinkFromUrl(url);
        selected ??= suggested;
        if (suggested.destination === 'social_post') {
          socialDraft = await socialMetadataService.fetch(url);
          common = mergePristineMetadata(commonFields(common), commonFields(socialDraft), dirty);
        } else if (suggested.destination === 'resource' && suggested.reason === 'known_resource_provider') {
          resourceMetadata = await resourceMetadataService.fetch(url);
          common = mergePristineMetadata(commonFields(common), {
            sourceUrl: resourceMetadata.sourceUrl,
            title: resourceMetadata.title,
            description: resourceMetadata.synopsis,
            imageUrl: resourceMetadata.cover,
            siteName: resourceMetadata.source,
          }, dirty);
          selected = { ...suggested, resourceMediaType: resourceMetadata.mediaType ?? suggested.resourceMediaType };
        } else if (url.startsWith('https://')) {
          recipeDraft = await recipeImportService.importUrl(url);
          common = mergePristineMetadata(commonFields(common), commonFields(recipeDraft), dirty);
          if (recipeDraft.ingredients.length > 0 || recipeDraft.instructions.length > 0) {
            suggested = { destination: 'recipe', confidence: 'high', reason: 'schema_org_recipe' };
            selected ??= suggested;
            if (selected.destination === 'resource' && selected.reason === 'generic_page') selected = suggested;
          }
        }
        status.textContent = suggested.confidence === 'medium'
          ? `Probably a ${labelForDestination(suggested.destination)}`
          : suggested.confidence === 'high'
            ? `Detected as ${labelForDestination(suggested.destination)}`
            : 'Could not determine the type confidently. You can still save this link manually.';
      } catch (error) {
        suggested = suggestLinkFromUrl(url);
        selected ??= suggested;
        status.textContent = 'Automatic metadata was not available. You can still save this link manually.';
        new Notice(error instanceof Error ? error.message : String(error));
      } finally {
        analyze.disabled = false;
        analyze.textContent = 'Analyze';
        render();
      }
    });
    urlInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        analyze.click();
      }
    });
    container.appendChild(analyze);

    if (!selected) return;

    const result = document.createElement('section');
    result.className = 'quartzo-link-capture-result';
    container.appendChild(result);

    const typeLabel = document.createElement('label');
    typeLabel.textContent = suggested?.confidence === 'medium' ? 'Probably' : 'Detected as';
    const destinationSelect = document.createElement('select');
    destinationSelect.className = 'quartzo-input';
    destinationSelect.setAttribute('aria-label', 'Change type');
    for (const destination of ['social_post', 'recipe', 'resource'] as LinkCaptureDestination[]) {
      const option = document.createElement('option');
      option.value = destination;
      option.textContent = labelForDestination(destination);
      option.selected = destination === selected.destination;
      destinationSelect.appendChild(option);
    }
    destinationSelect.addEventListener('change', () => {
      selected = applyUserLinkSelection(suggested ?? selected!, {
        destination: destinationSelect.value as LinkCaptureDestination,
        resourceMediaType: resourceTypeInput?.value || selected?.resourceMediaType || 'General',
        socialPlatform: socialDraft?.platform ?? selected?.socialPlatform ?? suggested?.socialPlatform ?? 'other',
        socialMediaType: socialDraft?.mediaType ?? selected?.socialMediaType ?? suggested?.socialMediaType ?? 'other',
      });
      render();
    });
    typeLabel.appendChild(destinationSelect);
    result.appendChild(typeLabel);

    let resourceTypeInput: HTMLInputElement | null = null;
    if (selected.destination === 'resource') {
      resourceTypeInput = document.createElement('input');
      resourceTypeInput.className = 'quartzo-input';
      resourceTypeInput.setAttribute('aria-label', 'Resource type');
      resourceTypeInput.setAttribute('list', 'quartzo-link-resource-types');
      resourceTypeInput.value = selected.resourceMediaType ?? 'General';
      resourceTypeInput.addEventListener('input', () => {
        selected = { ...selected!, resourceMediaType: resourceTypeInput?.value ?? 'General' };
      });
      const datalist = document.createElement('datalist');
      datalist.id = 'quartzo-link-resource-types';
      for (const type of resourceTypeSuggestions(options.getIndex())) {
        const option = document.createElement('option');
        option.value = type;
        datalist.appendChild(option);
      }
      result.appendChild(resourceTypeInput);
      result.appendChild(datalist);
    }

    const titleInput = field('Title', common.title ?? fallbackTitle(common.sourceUrl, selected.destination));
    titleInput.addEventListener('input', () => { dirty.add('title'); common.title = titleInput.value; });
    result.appendChild(titleInput);

    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'quartzo-input';
    descriptionInput.setAttribute('aria-label', selected.destination === 'resource' ? 'Synopsis or notes' : 'Notes');
    descriptionInput.value = common.description ?? '';
    descriptionInput.addEventListener('input', () => { dirty.add('description'); common.description = descriptionInput.value; });
    result.appendChild(descriptionInput);

    const imageInput = field('Image URL', common.imageUrl ?? '');
    imageInput.type = 'url';
    imageInput.addEventListener('input', () => { dirty.add('imageUrl'); common.imageUrl = imageInput.value; });
    result.appendChild(imageInput);

    const summary = document.createElement('p');
    summary.textContent = resultSummary(selected, recipeDraft);
    result.appendChild(summary);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'mod-cta';
    save.textContent = `Save as ${labelForDestination(selected.destination)}`;
    save.addEventListener('click', async () => {
      await saveSelected({
        context,
        options,
        selected: selected!,
        common: { ...common, title: titleInput.value, description: descriptionInput.value, imageUrl: imageInput.value },
        recipeDraft,
        socialDraft,
        resourceMetadata,
        resourceMediaType: resourceTypeInput?.value ?? selected?.resourceMediaType ?? 'General',
      });
    });
    result.appendChild(save);
  };

  render();
}

async function saveSelected(args: {
  context: ViewContext;
  options: LinkCaptureRendererOptions;
  selected: LinkCaptureSuggestion;
  common: LinkCaptureMetadata;
  recipeDraft: RecipeImportDraft | null;
  socialDraft: SocialMetadataDraft | null;
  resourceMetadata: Awaited<ReturnType<ResourceMetadataService['fetch']>> | null;
  resourceMediaType: string;
}): Promise<void> {
  const { context, options, selected, common } = args;
  const title = (common.title ?? fallbackTitle(common.sourceUrl, selected.destination)).trim();
  const duplicate = duplicateIdsFor(args);
  if (duplicate.length > 0) {
    renderDuplicateNotice(context, options, duplicate, selected.destination);
    return;
  }
  const settings = await options.settingsRepository.load();
  const id = createCanonicalObjectId();
  const type: QuickAddType = selected.destination === 'recipe' ? 'recipe' : selected.destination;
  const documentData = buildQuickAddDocument(settings, type, {
    title,
    body: bodyFor(args),
    resource: selected.destination === 'resource' ? {
      mediaType: args.resourceMediaType.trim() || 'General',
      sourceUrl: common.sourceUrl,
      cover: common.imageUrl ?? args.resourceMetadata?.cover,
      author: args.resourceMetadata?.author,
      year: args.resourceMetadata?.year,
      pages: args.resourceMetadata?.pages,
      category: args.resourceMetadata?.category,
      isbn: args.resourceMetadata?.isbn,
      googleBooksId: args.resourceMetadata?.googleBooksId,
      imdbId: args.resourceMetadata?.imdbId,
    } : undefined,
    recipe: selected.destination === 'recipe' ? {
      sourceUrl: common.sourceUrl,
      coverImageUrl: common.imageUrl,
      recipeSourceName: args.recipeDraft?.sourceName ?? common.siteName,
      servings: args.recipeDraft?.servings,
      prepTimeMinutes: args.recipeDraft?.prepTimeMinutes,
      cookTimeMinutes: args.recipeDraft?.cookTimeMinutes,
      totalTimeMinutes: args.recipeDraft?.totalTimeMinutes,
    } : undefined,
    socialPost: selected.destination === 'social_post' ? {
      url: common.sourceUrl ?? '',
      platform: args.socialDraft?.platform ?? selected.socialPlatform ?? 'other',
      mediaType: args.socialDraft?.mediaType ?? selected.socialMediaType ?? 'other',
      caption: args.socialDraft?.caption,
      thumbnail: args.socialDraft?.thumbnail ?? common.imageUrl,
      personalNote: common.description,
    } : undefined,
  }, id);
  await options.ensureParentFolders(documentData.path);
  if (context.app.vault.getAbstractFileByPath(documentData.path)) {
    throw new Error(`Target already exists: ${documentData.path}`);
  }
  await context.app.vault.create(documentData.path, documentData.content);
  await options.onCreated?.({ id, type, path: documentData.path });
  new Notice(`${labelForDestination(selected.destination)} created`);
  options.close();
}

function duplicateIdsFor(args: {
  options: LinkCaptureRendererOptions;
  selected: LinkCaptureSuggestion;
  common: LinkCaptureMetadata;
  resourceMediaType: string;
  resourceMetadata: Awaited<ReturnType<ResourceMetadataService['fetch']>> | null;
}): string[] {
  const index = args.options.getIndex();
  if (!index) return [];
  if (args.selected.destination === 'recipe') {
    return findRecipeDuplicates(args.common.sourceUrl, [...index.objects.values()].map(item => ({
      id: item.id,
      type: String(item.frontmatter.type ?? ''),
      note_subtype: item.frontmatter.note_subtype == null ? undefined : String(item.frontmatter.note_subtype),
      source_url: item.frontmatter.source_url == null ? undefined : String(item.frontmatter.source_url),
      archived: item.frontmatter.archived === true,
    })));
  }
  if (args.selected.destination === 'social_post') {
    return findSocialPostDuplicates(args.common.sourceUrl, [...index.objects.values()].map(item => ({
      id: item.id,
      type: String(item.frontmatter.type ?? ''),
      url: item.frontmatter.url == null ? undefined : String(item.frontmatter.url),
      archived: item.frontmatter.archived === true,
    })));
  }
  const candidate: ResourceIdentity = {
    title: args.common.title ?? '',
    mediaType: args.resourceMediaType,
    sourceUrl: args.common.sourceUrl,
    isbn: args.resourceMetadata?.isbn,
    googleBooksId: args.resourceMetadata?.googleBooksId,
    imdbId: args.resourceMetadata?.imdbId,
  };
  const resources = queryVaultObjects(index, { types: ['resource'] }).map(object => ({
    id: object.id,
    title: String(object.frontmatter.title ?? ''),
    mediaType: String(object.frontmatter.media_type ?? ''),
    sourceUrl: object.frontmatter.source_url == null ? undefined : String(object.frontmatter.source_url),
    isbn: object.frontmatter.isbn == null ? undefined : String(object.frontmatter.isbn),
    googleBooksId: object.frontmatter.google_books_id == null ? undefined : String(object.frontmatter.google_books_id),
    imdbId: object.frontmatter.imdb_id == null ? undefined : String(object.frontmatter.imdb_id),
    archived: object.frontmatter.archived === true,
  }));
  return findResourceDuplicates(candidate, resources).map(item => item.id);
}

function renderDuplicateNotice(
  context: ViewContext,
  options: LinkCaptureRendererOptions,
  duplicateIds: string[],
  destination: LinkCaptureDestination,
): void {
  const first = duplicateIds.map(id => options.getIndex()?.objects.get(id)).find((item): item is IndexedObject => item != null);
  new Notice(destination === 'resource' ? 'Already saved. Open existing or create manually from Resource if needed.' : 'Already saved.');
  if (first) void options.openIndexedObject(first);
}

function bodyFor(args: { selected: LinkCaptureSuggestion; common: LinkCaptureMetadata; recipeDraft: RecipeImportDraft | null }): string {
  if (args.selected.destination === 'recipe') {
    return buildRecipeBody({
      description: args.common.description ?? args.recipeDraft?.description,
      ingredients: args.recipeDraft?.ingredients ?? [],
      instructions: args.recipeDraft?.instructions ?? [],
      notes: '',
    });
  }
  return args.common.description ?? '';
}

function field(label: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'quartzo-input';
  input.type = 'text';
  input.placeholder = label;
  input.setAttribute('aria-label', label);
  input.value = value;
  return input;
}

function commonFields(value: LinkCaptureMetadata): Record<string, string | undefined> {
  return {
    sourceUrl: value.sourceUrl,
    resolvedUrl: value.resolvedUrl,
    title: value.title,
    description: value.description,
    imageUrl: value.imageUrl,
    siteName: value.siteName,
    publishedAt: value.publishedAt,
  };
}

function labelForDestination(destination: LinkCaptureDestination): string {
  if (destination === 'social_post') return 'Social Post';
  if (destination === 'recipe') return 'Recipe';
  return 'Resource';
}

function fallbackTitle(url: string | undefined, destination: LinkCaptureDestination): string {
  if (!url) return labelForDestination(destination);
  try {
    const parsed = new URL(url);
    return parsed.hostname || labelForDestination(destination);
  } catch {
    return labelForDestination(destination);
  }
}

function resultSummary(selected: LinkCaptureSuggestion, recipeDraft: RecipeImportDraft | null): string {
  if (selected.destination === 'recipe') {
    const ingredients = recipeDraft?.ingredients.length ?? 0;
    const instructions = recipeDraft?.instructions.length ?? 0;
    return ingredients > 0 || instructions > 0
      ? `${ingredients} ingredients · ${instructions} instructions`
      : 'Automatic metadata was not available. You can still save this link manually.';
  }
  if (selected.destination === 'resource') return 'Resource type can be a custom value.';
  return 'Social metadata can be edited after save from the Markdown file.';
}

function resourceTypeSuggestions(index: VaultIndex | null): string[] {
  const used = new Set<string>(RESOURCE_TYPES);
  if (index) {
    for (const object of queryVaultObjects(index, { types: ['resource'] })) {
      const value = object.frontmatter.media_type;
      if (typeof value === 'string' && value.trim()) used.add(value.trim());
    }
  }
  return [...used].sort((left, right) => left.localeCompare(right));
}
