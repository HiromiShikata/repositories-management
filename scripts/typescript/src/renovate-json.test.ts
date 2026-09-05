import * as fs from 'fs';
import * as path from 'path';

const rootRenovatePath = path.join(__dirname, '../../../renovate.json');
const typescriptRenovatePath = path.join(__dirname, '../renovate.json');

const readPlatformAutomerge = (filePath: string): unknown => {
  const raw = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const parsed: unknown = JSON.parse(raw);
  if (parsed !== null && typeof parsed === 'object' && 'platformAutomerge' in parsed) {
    return parsed.platformAutomerge;
  }
  return undefined;
};

describe('renovate.json security settings', () => {
  test('root renovate.json sets platformAutomerge to false', () => {
    expect(readPlatformAutomerge(rootRenovatePath)).toBe(false);
  });

  test('scripts/typescript renovate.json sets platformAutomerge to false', () => {
    expect(readPlatformAutomerge(typescriptRenovatePath)).toBe(false);
  });
});
