import * as fs from 'fs';
import * as path from 'path';

const rootRenovatePath = path.join(__dirname, '../../../renovate.json');
const typescriptRenovatePath = path.join(__dirname, '../renovate.json');

const readRenovateConfig = (filePath: string): unknown => {
  const raw = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(raw);
};

describe('renovate.json switches Renovate off entirely', () => {
  test('root renovate.json contains only the enabled: false directive', () => {
    expect(readRenovateConfig(rootRenovatePath)).toEqual({ enabled: false });
  });

  test('scripts/typescript renovate.json contains only the enabled: false directive', () => {
    expect(readRenovateConfig(typescriptRenovatePath)).toEqual({
      enabled: false,
    });
  });
});
