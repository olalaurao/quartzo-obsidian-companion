export type ActivityEventType =
  | 'object_created'
  | 'object_edited'
  | 'object_moved'
  | 'object_retired'
  | 'capture_created'
  | 'occurrence_completed'
  | 'occurrence_already_did'
  | 'occurrence_skipped'
  | 'occurrence_rescheduled'
  | 'tracking_record_created'
  | 'system_manually_run'
  | 'routine_manually_run'
  | 'focus_session_completed';

export type ActivityCategory =
  | 'notes'
  | 'tasks'
  | 'captures'
  | 'tracking'
  | 'systems'
  | 'focus';

export type ActivityCategoryFilter = 'all' | ActivityCategory;

export type ActivityPeriod = 'day' | 'week' | 'month' | 'year';

export type ActivityOriginKind =
  | 'app'
  | 'companion'
  | 'import'
  | 'sync'
  | 'automation'
  | 'external_integration';

export interface ActivityProvenance {
  providerId?: string;
  providerLabel?: string;
}

export interface ActivityEvent {
  eventId: string;
  occurredAt: string;
  eventType: ActivityEventType;
  sourceId: string;
  sourceType: string;
  sourcePath?: string;
  originClient: string;
  originKind: ActivityOriginKind;
  titleSnapshot: string;
  summary?: string;
  excerpt?: string;
  previousPath?: string;
  changedFieldCount?: number;
  operationId?: string;
  occurrenceId?: string;
  scheduledFor?: string;
  folder?: string;
  provenance?: ActivityProvenance;
  metadata?: Record<string, unknown>;
}

export interface ActivityProjectionOptions {
  period: ActivityPeriod;
  rangeStart: string;
  rangeEnd: string;
  categoryFilter: ActivityCategoryFilter;
  folderFilter: string | null;
  privacyMode: boolean;
}

export interface ProjectedActivityEvent extends ActivityEvent {
  category: ActivityCategory;
  localDate: string;
  folder: string;
  renderExcerpt: string | null;
  providerLabel: string | null;
  renderedEyebrow: string;
}

export interface ActivityTimelineGroup {
  id: string;
  label: string;
  count: number;
  eventIds: string[];
}

export interface ActivityCountBucket {
  id: string;
  label: string;
  count: number;
}

export interface ActivityProjection {
  visibleEvents: ProjectedActivityEvent[];
  groups: ActivityTimelineGroup[];
  total: number;
  byType: ActivityCountBucket[];
  hourlyBuckets: ActivityCountBucket[];
  heatmapBuckets: ActivityCountBucket[];
  folderBuckets: ActivityCountBucket[];
  emptyKind: 'none' | 'no-history' | 'filtered-empty';
}

export interface ActivityCapabilities {
  canvasActivity: boolean;
}

