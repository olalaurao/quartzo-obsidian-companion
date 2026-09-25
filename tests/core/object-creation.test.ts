import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { ObjectParser } from '../../src/core/objects';
import type { QuartzoSharedSettings } from '../../src/core/shared-settings';

const settings: QuartzoSharedSettings = {
  schemaVersion: 1,
  typeSignatures: {},
  folderPaths: {
    resource: 'resources',
    note: 'notes/custom',
    social_post: 'social/custom',
    entry: 'journal/entries',
    reminder: 'reminders',
  },
  categoryColors: {},
  accentColor: '#F97316',
  plannerColorMode: 'category',
  plannerVisibleKinds: [],
  plannerShowAdaptiveTimeBlocks: true,
  startOfWeek: 1,
  dayStartHour: 0,
  showDayDialLegend: true,
};

describe('buildQuickAddDocument', () => {
  it('creates a Resource in the canonical configured folder with links and categories', () => {
    const created = buildQuickAddDocument(
      settings,
      'resource',
      {
        title: 'The Hobbit',
        body: 'A hobbit goes on an unexpected journey.',
        resource: {
          mediaType: 'Book',
          sourceUrl: 'https://openlibrary.org/works/OL262758W',
          status: 'inProgress',
          priority: 'high',
          categories: ['reading', 'fantasy'],
          links: ['[[resources/lord-of-the-rings]]'],
          author: 'J.R.R. Tolkien',
          year: 1937,
          pages: 310,
          isbn: '9780547928227',
        },
      },
      'resource-hobbit',
    );

    expect(created.path).toBe('resources/resource-hobbit.md');
    const parsed = ObjectParser.parse(created.content);
    expect(parsed.object).toMatchObject({
      id: 'resource-hobbit',
      type: 'resource',
      title: 'The Hobbit',
      media_type: 'Book',
      source_url: 'https://openlibrary.org/works/OL262758W',
      status: 'inProgress',
      rating: 0,
      priority: 'high',
      categories: ['reading', 'fantasy'],
      links: ['[[resources/lord-of-the-rings]]'],
      author: 'J.R.R. Tolkien',
      year: 1937,
      pages: 310,
      isbn: '9780547928227',
      body: 'A hobbit goes on an unexpected journey.',
    });
  });

  it('requires a Resource title and media type instead of inventing identity', () => {
    expect(() => buildQuickAddDocument(
      settings,
      'resource',
      { title: '   ', body: '', resource: { mediaType: 'Book' } },
      'resource-no-title',
    )).toThrow('Resource title is required.');

    expect(() => buildQuickAddDocument(
      settings,
      'resource',
      { title: 'Untyped', body: '', resource: { mediaType: '   ' } },
      'resource-no-type',
    )).toThrow('Resource type is required.');
  });

  it('creates a Recipe as a canonical Note subtype', () => {
    const created = buildQuickAddDocument(
      settings,
      'recipe',
      {
        title: 'Crispy Potatoes',
        body: '<!-- quartzo:recipe:v1 -->\n\n<!-- quartzo:recipe:ingredients -->\n## Ingredients\n\n- Potato',
        recipe: {
          sourceUrl: 'https://food.example/potatoes',
          coverImageUrl: 'https://food.example/potatoes.jpg',
          recipeSourceName: 'Food Example',
          servings: '4',
          prepTimeMinutes: 10,
        },
      },
      'recipe-potatoes',
    );
    const parsed = ObjectParser.parse(created.content).object;
    expect(created.path).toBe('notes/custom/recipe-potatoes.md');
    expect(parsed).toMatchObject({
      id: 'recipe-potatoes',
      type: 'note',
      note_subtype: 'recipe',
      source_url: 'https://food.example/potatoes',
      cover_image_url: 'https://food.example/potatoes.jpg',
    });
  });

  it('creates a Social Post with canonical social fields', () => {
    const created = buildQuickAddDocument(
      settings,
      'social_post',
      {
        title: 'Instagram Reel',
        body: 'Saved for later',
        socialPost: {
          url: 'https://www.instagram.com/reel/abc/',
          platform: 'instagram',
          mediaType: 'video',
          caption: 'Crispy potatoes',
          thumbnail: 'https://cdn.example/thumb.jpg',
        },
      },
      'social-instagram',
    );
    const parsed = ObjectParser.parse(created.content).object;
    expect(created.path).toBe('social/custom/social-instagram.md');
    expect(parsed).toMatchObject({
      id: 'social-instagram',
      type: 'social_post',
      url: 'https://www.instagram.com/reel/abc/',
      platform: 'instagram',
      media_type: 'video',
    });
  });

  it('persists Quick Add Reminder as one exact canonical instant with embedded ReminderConfig', () => {
    const created = buildQuickAddDocument(
      settings,
      'reminder',
      { title: 'Call clinic', body: '', date: '2026-09-17', time: '09:30' },
      'reminder-call-clinic',
    );

    expect(created.path).toBe('reminders/reminder-call-clinic.md');
    const raw = ObjectParser.parseMarkdown(created.content).frontmatter;
    expect(raw).toMatchObject({
      date: '2026-09-17T09:30:00.000',
      time: '2026-09-17T09:30:00.000',
      is_completed: false,
      is_completable: true,
      reminder_id: 'reminder-call-clinic_primary',
      reminder_count: 1,
      reminders: [{
        id: 'reminder-call-clinic_primary',
        trigger_time: '2026-09-17T09:30:00.000',
        type: 'popup',
        notification_body: 'Call clinic',
      }],
    });
    const parsed = ObjectParser.parse(created.content);
    expect(parsed.object).toMatchObject({
      id: 'reminder-call-clinic',
      type: 'reminder',
      date: '2026-09-17',
      time: '09:30',
      reminder_id: 'reminder-call-clinic_primary',
    });
  });
  it('fails closed when no canonical Resource creation folder is configured', () => {
    expect(() => buildQuickAddDocument(
      { ...settings, folderPaths: {} },
      'resource',
      { title: 'No Folder', body: '', resource: { mediaType: 'Book' } },
      'resource-no-folder',
    )).toThrow('No canonical creation folder is configured for resource');
  });
});
