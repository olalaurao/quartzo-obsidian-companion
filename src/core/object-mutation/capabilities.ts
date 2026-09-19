import coverage from '../../../contracts/quartzo/object_fixtures/coverage.json';

type MutationSupport = 'full' | 'limited' | 'none';

interface CoverageRow {
  type: string;
  parse: boolean;
  roundtrip: boolean;
  mutationSupport: MutationSupport;
  fixtureCoverage: string;
}

const rows = coverage as CoverageRow[];

function coverageTypeForObjectType(objectType: string): string {
  switch (objectType) {
    case 'tracker_definition': return 'tracker';
    case 'pomodoro_session': return 'pomodoro';
    case 'combined_analysis': return 'analysis';
    default: return objectType;
  }
}

export function objectMutationSupport(objectType: string): MutationSupport {
  const coverageType = coverageTypeForObjectType(objectType);
  return rows.find(row => row.type === coverageType)?.mutationSupport ?? 'none';
}

export function hasFullObjectMutationSupport(objectType: string): boolean {
  const coverageType = coverageTypeForObjectType(objectType);
  const row = rows.find(candidate => candidate.type === coverageType);
  return row?.parse === true &&
    row.roundtrip === true &&
    row.mutationSupport === 'full' &&
    row.fixtureCoverage === 'concrete_mutation';
}

export function fullMutationObjectTypes(): string[] {
  return rows
    .filter(row =>
      row.parse === true &&
      row.roundtrip === true &&
      row.mutationSupport === 'full' &&
      row.fixtureCoverage === 'concrete_mutation')
    .map(row => row.type);
}
