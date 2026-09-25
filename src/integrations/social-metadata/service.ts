import { suggestLinkFromUrl, type LinkCaptureMetadata } from '../../core/link-capture/policy';

export interface SocialMetadataDraft extends LinkCaptureMetadata {
  platform: string;
  mediaType: 'video' | 'image' | 'carousel' | 'article' | 'newsletter' | 'other';
  caption?: string;
  thumbnail?: string;
}

export class SocialMetadataService {
  async fetch(url: string): Promise<SocialMetadataDraft> {
    const suggestion = suggestLinkFromUrl(url);
    return {
      sourceUrl: url,
      resolvedUrl: url,
      title: fallbackSocialTitle(url, suggestion.socialPlatform),
      platform: suggestion.socialPlatform ?? 'other',
      mediaType: suggestion.socialMediaType ?? 'other',
    };
  }
}

function fallbackSocialTitle(url: string, platform: string | undefined): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? `${platform ?? 'Social'} ${last}` : `${platform ?? 'Social'} post`;
  } catch {
    return 'Social post';
  }
}
