import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/ui/shell/view.ts');
let source = fs.readFileSync(file, 'utf8');

function replaceExact(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing expected source for ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Expected one source for ${label}`);
  source = source.replace(from, to);
}

replaceExact(
  "import { findResourceDuplicates, type ResourceIdentity } from '../../core/resource-capture/policy';\n",
  "import { findResourceDuplicates, type ResourceIdentity } from '../../core/resource-capture/policy';\nimport { ResourceMetadataService, type ResourceMetadataDraft } from '../../integrations/resource-metadata/service';\n",
  'metadata service import',
);

replaceExact(
  "  private type: QuickAddType = 'task';\n  private settingsRepository: SharedSettingsRepository;",
  "  private type: QuickAddType = 'task';\n  private settingsRepository: SharedSettingsRepository;\n  private readonly resourceMetadataService = new ResourceMetadataService();",
  'metadata service owner',
);

replaceExact(
  `    let sourceUrlInput: HTMLInputElement | null = null;\n    let mediaTypeSelect: HTMLSelectElement | null = null;\n    let prioritySelect: HTMLSelectElement | null = null;\n    let statusSelect: HTMLSelectElement | null = null;\n    let categoriesInput: HTMLInputElement | null = null;\n    let relationsSelect: HTMLSelectElement | null = null;\n    if (this.type === 'resource') {`,
  `    let sourceUrlInput: HTMLInputElement | null = null;\n    let mediaTypeSelect: HTMLSelectElement | null = null;\n    let prioritySelect: HTMLSelectElement | null = null;\n    let statusSelect: HTMLSelectElement | null = null;\n    let categoriesInput: HTMLInputElement | null = null;\n    let relationsSelect: HTMLSelectElement | null = null;\n    let resourceMetadata: ResourceMetadataDraft | null = null;\n    let titleEdited = false;\n    let bodyEdited = false;\n    let mediaTypeEdited = false;\n    if (this.type === 'resource') {\n      titleInput.addEventListener('input', () => { titleEdited = true; });\n      bodyInput.addEventListener('input', () => { bodyEdited = true; });`,
  'metadata state and edit guards',
);

replaceExact(
  `      sourceUrlInput.placeholder = 'Source URL (optional)';\n      sourceUrlInput.className = 'quartzo-input';\n      contentEl.appendChild(sourceUrlInput);\n\n      mediaTypeSelect = this.createSelect('Resource type', [\n        'Book', 'Movie', 'Show', 'Video', 'Podcast', 'Article', 'Course', 'General',\n      ]);\n      contentEl.appendChild(mediaTypeSelect);`,
  `      sourceUrlInput.placeholder = 'Source URL (optional)';\n      sourceUrlInput.className = 'quartzo-input';\n      sourceUrlInput.addEventListener('input', () => { resourceMetadata = null; });\n      contentEl.appendChild(sourceUrlInput);\n\n      mediaTypeSelect = this.createSelect('Resource type', [\n        'General', 'Book', 'Movie', 'Show', 'Video', 'Podcast', 'Article', 'Course',\n      ]);\n      mediaTypeSelect.addEventListener('change', () => { mediaTypeEdited = true; });\n      contentEl.appendChild(mediaTypeSelect);\n\n      const metadataStatus = document.createElement('small');\n      metadataStatus.textContent = 'Paste a supported link and fetch metadata, or fill the fields manually.';\n      const fetchMetadata = document.createElement('button');\n      fetchMetadata.type = 'button';\n      fetchMetadata.textContent = 'Fetch metadata';\n      fetchMetadata.addEventListener('click', async () => {\n        const url = sourceUrlInput?.value.trim() ?? '';\n        if (!url) {\n          new Notice('Paste a Resource URL first.');\n          return;\n        }\n        fetchMetadata.disabled = true;\n        fetchMetadata.textContent = 'Fetching…';\n        metadataStatus.textContent = 'Checking supported metadata providers…';\n        try {\n          const metadata = await this.resourceMetadataService.fetch(url);\n          resourceMetadata = metadata.sourceUrl === url ? metadata : null;\n          if (!metadata.fetched) {\n            metadataStatus.textContent = 'No automatic metadata found. You can still save this Resource manually.';\n            return;\n          }\n          if (!titleEdited && metadata.title) titleInput.value = metadata.title;\n          if (!bodyEdited && metadata.synopsis) bodyInput.value = metadata.synopsis;\n          if (!mediaTypeEdited && metadata.mediaType && mediaTypeSelect) {\n            const supported = Array.from(mediaTypeSelect.options).some(option => option.value === metadata.mediaType);\n            if (supported) mediaTypeSelect.value = metadata.mediaType;\n          }\n          const details = [metadata.author, metadata.year, metadata.pages ? \`${'${metadata.pages}'} pages\` : undefined]\n            .filter((value): value is string | number => value != null && value !== '');\n          metadataStatus.textContent = details.length > 0\n            ? \`Metadata loaded: \${details.join(' • ')}\`\n            : 'Metadata loaded. Review the fields before saving.';\n        } finally {\n          fetchMetadata.disabled = false;\n          fetchMetadata.textContent = 'Fetch metadata';\n        }\n      });\n      contentEl.appendChild(fetchMetadata);\n      contentEl.appendChild(metadataStatus);`,
  'metadata button and non-overwrite behavior',
);

replaceExact(
  `        const resourceInput = this.type === 'resource'\n          ? {\n              mediaType: mediaTypeSelect?.value ?? '',\n              sourceUrl: sourceUrlInput?.value,\n              priority: (prioritySelect?.value ?? 'none') as 'none' | 'low' | 'medium' | 'high',\n              status: (statusSelect?.value ?? 'toConsume') as 'toConsume' | 'inProgress' | 'completed' | 'dropped',\n              categories: this.csvValues(categoriesInput?.value ?? ''),\n              links: relationsSelect == null\n                ? []\n                : Array.from(relationsSelect.selectedOptions).map(option => option.value),\n            }\n          : undefined;`,
  `        const currentResourceUrl = sourceUrlInput?.value.trim() ?? '';\n        const currentMetadata = resourceMetadata?.sourceUrl === currentResourceUrl && resourceMetadata.fetched\n          ? resourceMetadata\n          : null;\n        const resourceInput = this.type === 'resource'\n          ? {\n              mediaType: mediaTypeSelect?.value ?? '',\n              sourceUrl: currentResourceUrl || undefined,\n              priority: (prioritySelect?.value ?? 'none') as 'none' | 'low' | 'medium' | 'high',\n              status: (statusSelect?.value ?? 'toConsume') as 'toConsume' | 'inProgress' | 'completed' | 'dropped',\n              categories: this.csvValues(categoriesInput?.value ?? ''),\n              links: relationsSelect == null\n                ? []\n                : Array.from(relationsSelect.selectedOptions).map(option => option.value),\n              cover: currentMetadata?.cover,\n              author: currentMetadata?.author,\n              year: currentMetadata?.year,\n              pages: currentMetadata?.pages,\n              category: currentMetadata?.category,\n              isbn: currentMetadata?.isbn,\n              googleBooksId: currentMetadata?.googleBooksId,\n              imdbId: currentMetadata?.imdbId,\n            }\n          : undefined;`,
  'metadata included in canonical Resource save',
);

replaceExact(
  `            sourceUrl: resourceInput.sourceUrl,\n          };`,
  `            sourceUrl: resourceInput.sourceUrl,\n            isbn: resourceInput.isbn,\n            googleBooksId: resourceInput.googleBooksId,\n            imdbId: resourceInput.imdbId,\n          };`,
  'metadata identifiers included in duplicate detection',
);

fs.writeFileSync(file, source);
console.log('Resource metadata is wired through the integration service into Quick Add.');
