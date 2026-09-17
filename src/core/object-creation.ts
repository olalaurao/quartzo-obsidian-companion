import { ObjectParser } from './objects';
import { localIsoDate } from './local-date';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from './shared-settings';

export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder' | 'resource' | 'tracker_record';

export interface ResourceQuickAddInput {
  mediaType: string;
  sourceUrl?: string;
  status?: 'toConsume' | 'inProgress' | 'completed' | 'dropped';
  priority?: 'none' | 'low' | 'medium' | 'high';
  categories?: string[];
  tags?: string[];
  links?: string[];
  cover?: string;
  author?: string;
  year?: number;
  pages?: number;
  category?: string;
  isbn?: string;
  googleBooksId?: string;
  imdbId?: string;
}

export interface TrackerRecordQuickAddInput {
  trackerId: string;
  trackerTitle: string;
  date: string;
  fieldValues: Record<string, unknown>;
}

export interface QuickAddInput {
  title: string;
  body: string;
  date?: string;
  time?: string;
  resource?: ResourceQuickAddInput;
  record?: TrackerRecordQuickAddInput;
}

export function buildQuickAddDocument(
  settings: QuartzoSharedSettings | null,
  type: QuickAddType,
  input: QuickAddInput,
  id: string,
): { path: string; content: string } {
  const folder = resolveCreationFolder(settings, type);
  if (!folder) {
    throw new Error(`No canonical creation folder is configured for ${type}. Configure Object Identification in Quartzo first.`);
  }

  const trimmedTitle = input.title.trim();
  if (type === 'resource' && !trimmedTitle) {
    throw new Error('Resource title is required.');
  }
  const record = type === 'tracker_record' ? input.record : undefined;
  if (type === 'tracker_record' && !record) throw new Error('Record fields are required.');
  const recordTrackerTitle = record?.trackerTitle.trim() ?? '';
  if (type === 'tracker_record' && !recordTrackerTitle) throw new Error('Record Tracker title is required.');
  const title = type === 'tracker_record'
    ? `${recordTrackerTitle} ${record?.date ?? ''}`.trim()
    : trimmedTitle || (type === 'entry' ? 'Journal Entry' : 'Untitled');
  const frontmatter: Record<string, unknown> = { id, type, title };

  if (type === 'entry') {
    frontmatter.date = input.date ?? localIsoDate(new Date());
    if (input.time) frontmatter.time = input.time;
  }
  if (type === 'reminder') {
    frontmatter.date = input.date ?? localIsoDate(new Date());
    frontmatter.time = input.time ?? '09:00';
    frontmatter.is_completed = false;
    frontmatter.reminder_id = id;
    frontmatter.reminder_count = 1;
  }
  if (type === 'tracker_record') {
    const trackerId = record?.trackerId.trim() ?? '';
    const date = record?.date.trim() ?? '';
    if (!trackerId) throw new Error('Record Tracker is required.');
    if (!date) throw new Error('Record date is required.');
    frontmatter.tracker_id = trackerId;
    frontmatter.date = date;
    frontmatter.field_values = { ...(record?.fieldValues ?? {}) };
    frontmatter.categories = ['[[tracker_records]]'];
  }
  if (type === 'resource') {
    const resource = input.resource;
    if (!resource) throw new Error('Resource fields are required.');
    const mediaType = resource.mediaType.trim();
    if (!mediaType) throw new Error('Resource type is required.');

    frontmatter.media_type = mediaType;
    frontmatter.status = resource.status ?? 'toConsume';
    frontmatter.rating = 0;
    frontmatter.priority = resource.priority ?? 'none';

    const assignText = (key: string, value: string | undefined): void => {
      const normalized = value?.trim();
      if (normalized) frontmatter[key] = normalized;
    };
    assignText('source_url', resource.sourceUrl);
    assignText('cover', resource.cover);
    assignText('author', resource.author);
    assignText('category', resource.category);
    assignText('isbn', resource.isbn);
    assignText('google_books_id', resource.googleBooksId);
    assignText('imdb_id', resource.imdbId);
    if (resource.year != null) frontmatter.year = resource.year;
    if (resource.pages != null) frontmatter.pages = resource.pages;
    if (resource.categories?.length) frontmatter.categories = resource.categories;
    if (resource.tags?.length) frontmatter.tags = resource.tags;
    if (resource.links?.length) frontmatter.links = resource.links;
  }

  const signature = resolveTypeSignature(settings, type);
  const signed = applyTypeSignature(frontmatter, input.body, signature);
  const path = `${folder}/${id}.md`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const roundtrip = ObjectParser.parse(content);
  if (roundtrip.object.id !== id || roundtrip.object.type !== type) {
    throw new Error(`Creation roundtrip failed for ${type}`);
  }
  return { path, content };
}
