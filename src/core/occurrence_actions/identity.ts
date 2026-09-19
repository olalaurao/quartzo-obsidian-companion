export function occurrenceResponseIdForDailyItem(itemId: string, date: string): string {
  const normalizedId = itemId.trim();
  const normalizedDate = date.trim();
  if (!normalizedId) throw new Error('Daily item id is required for occurrence identity.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new Error('Daily occurrence date must use YYYY-MM-DD.');
  }
  return normalizedId.endsWith(`@${normalizedDate}`)
    ? normalizedId
    : `${normalizedId}@${normalizedDate}`;
}
