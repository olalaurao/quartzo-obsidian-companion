import { ObjectParser } from './objects';
import { localIsoDate } from './local-date';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from './shared-settings';

export type QuickAddType = 'task' | 'entry' | 'note' | 'reminder' | 'resource' | 'tracker_record' | 'recipe' | 'social_post';

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

export interface RecipeQuickAddInput {
  sourceUrl?: string;
  coverImageUrl?: string;
  recipeSourceName?: string;
  servings?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
}

export interface SocialPostQuickAddInput {
  url: string;
  platform: string;
  mediaType?: string;
  caption?: string;
  creator?: string;
  authorHandle?: string;
  authorName?: string;
  thumbnail?: string;
  embedUrl?: string;
  videoUrl?: string;
  postedAt?: string;
  personalNote?: string;
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
  recipe?: RecipeQuickAddInput;
  socialPost?: SocialPostQuickAddInput;
  record?: TrackerRecordQuickAddInput;
}

export function buildQuickAddDocument(
  settings: QuartzoSharedSettings | null,
  type: QuickAddType,
  input: QuickAddInput,
  id: string,
): { path: string; content: string } {
  const canonicalObjectType = type === 'recipe' ? 'note' : type;
  const folder = resolveCreationFolder(settings, canonicalObjectType);
  if (!folder) {
    throw new Error(`No canonical creation folder is configured for ${canonicalObjectType}. Configure Object Identification in Quartzo first.`);
  }

  const trimmedTitle = input.title.trim();
  if ((type === 'resource' || type === 'recipe' || type === 'social_post') && !trimmedTitle) {
    throw new Error(`${type === 'social_post' ? 'Social Post' : labelForCreationType(type)} title is required.`);
  }
  const record = type === 'tracker_record' ? input.record : undefined;
  if (type === 'tracker_record' && !record) throw new Error('Record fields are required.');
  const recordTrackerTitle = record?.trackerTitle.trim() ?? '';
  if (type === 'tracker_record' && !recordTrackerTitle) throw new Error('Record Tracker title is required.');
  const title = type === 'tracker_record'
    ? `${recordTrackerTitle} ${record?.date ?? ''}`.trim()
    : trimmedTitle || (type === 'entry' ? 'Journal Entry' : 'Untitled');
  const frontmatter: Record<string, unknown> = { id, type: canonicalObjectType, title };

  if (type === 'recipe') {
    const recipe = input.recipe;
    frontmatter.note_subtype = 'recipe';
    assignText(frontmatter, 'source_url', recipe?.sourceUrl);
    assignText(frontmatter, 'cover_image_url', recipe?.coverImageUrl);
    assignText(frontmatter, 'recipe_source_name', recipe?.recipeSourceName);
    assignText(frontmatter, 'servings', recipe?.servings);
    if (recipe?.prepTimeMinutes != null) frontmatter.prep_time_minutes = recipe.prepTimeMinutes;
    if (recipe?.cookTimeMinutes != null) frontmatter.cook_time_minutes = recipe.cookTimeMinutes;
    if (recipe?.totalTimeMinutes != null) frontmatter.total_time_minutes = recipe.totalTimeMinutes;
  }

  if (type === 'social_post') {
    const social = input.socialPost;
    if (!social?.url.trim()) throw new Error('Social Post URL is required.');
    if (!social.platform.trim()) throw new Error('Social Post platform is required.');
    frontmatter.url = social.url.trim();
    frontmatter.platform = social.platform.trim();
    frontmatter.media_type = social.mediaType?.trim() || 'other';
    assignText(frontmatter, 'caption', social.caption);
    assignText(frontmatter, 'creator', social.creator);
    assignText(frontmatter, 'author_handle', social.authorHandle);
    assignText(frontmatter, 'author_name', social.authorName);
    assignText(frontmatter, 'thumbnail', social.thumbnail);
    assignText(frontmatter, 'embed_url', social.embedUrl);
    assignText(frontmatter, 'video_url', social.videoUrl);
    assignText(frontmatter, 'posted_at', social.postedAt);
    frontmatter.watched = false;
  }

  if (type === 'entry') {
    frontmatter.date = input.date ?? localIsoDate(new Date());
    if (input.time) frontmatter.time = input.time;
  }
  if (type === 'reminder') {
    const date = input.date ?? localIsoDate(new Date());
    const time = input.time ?? '09:00';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Reminder date is invalid.');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Reminder time is invalid.');
    const triggerTime = `${date}T${time}:00.000`;
    const primaryReminderId = `${id}_primary`;
    frontmatter.date = triggerTime;
    frontmatter.time = triggerTime;
    frontmatter.is_completed = false;
    frontmatter.is_completable = true;
    frontmatter.reminder_id = primaryReminderId;
    frontmatter.reminder_count = 1;
    frontmatter.reminders = [{
      id: primaryReminderId,
      trigger_time: triggerTime,
      type: 'popup',
      notification_body: title,
    }];
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

    assignText(frontmatter, 'source_url', resource.sourceUrl);
    assignText(frontmatter, 'cover', resource.cover);
    assignText(frontmatter, 'author', resource.author);
    assignText(frontmatter, 'category', resource.category);
    assignText(frontmatter, 'isbn', resource.isbn);
    assignText(frontmatter, 'google_books_id', resource.googleBooksId);
    assignText(frontmatter, 'imdb_id', resource.imdbId);
    if (resource.year != null) frontmatter.year = resource.year;
    if (resource.pages != null) frontmatter.pages = resource.pages;
    if (resource.categories?.length) frontmatter.categories = resource.categories;
    if (resource.tags?.length) frontmatter.tags = resource.tags;
    if (resource.links?.length) frontmatter.links = resource.links;
  }

  const signature = resolveTypeSignature(settings, canonicalObjectType);
  const signed = applyTypeSignature(frontmatter, input.body, signature);
  const path = `${folder}/${id}.md`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
  const roundtrip = ObjectParser.parse(content);
  if (roundtrip.object.id !== id || roundtrip.object.type !== canonicalObjectType) {
    throw new Error(`Creation roundtrip failed for ${type}`);
  }
  if (type === 'recipe' && roundtrip.object.type === 'note' && roundtrip.object.note_subtype !== 'recipe') {
    throw new Error('Creation roundtrip failed for recipe.');
  }
  return { path, content };
}

function assignText(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  const normalized = value?.trim();
  if (!normalized) return;
  target[key] = normalized;
}

function labelForCreationType(type: QuickAddType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
