import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

const labelsYamlPath = path.join(__dirname, '../../../labels.yaml');

type LabelEntry = {
  name: string;
  color: string;
  aliases: string[];
  description: string;
  delete: boolean;
};

const isLabelEntry = (entry: unknown): entry is LabelEntry =>
  typeof entry === 'object' &&
  entry !== null &&
  'name' in entry &&
  'aliases' in entry &&
  'delete' in entry;

const parseLabelEntries = (data: unknown): LabelEntry[] => {
  if (!Array.isArray(data) || !data.every(isLabelEntry)) {
    throw new Error('labels.yaml has unexpected structure');
  }
  return data;
};

const labelEntries = parseLabelEntries(
  load(fs.readFileSync(labelsYamlPath, 'utf8')),
);

const findPrimaryLabel = (name: string): LabelEntry | undefined =>
  labelEntries.find((entry) => entry.name === name);

const findPrimaryLabelByAlias = (alias: string): LabelEntry | undefined =>
  labelEntries.find((entry) => entry.aliases.includes(alias));

describe('labels.yaml claude model labels', () => {
  test('claude-opus-5 is the active opus label with delete false', () => {
    const label = findPrimaryLabel('llm-model:claude-opus-5');
    expect(label).toBeDefined();
    expect(label?.delete).toBe(false);
  });

  test('claude-opus-4-7 is an alias of claude-opus-5 enabling automatic migration of existing issues', () => {
    expect(findPrimaryLabel('llm-model:claude-opus-4-7')).toBeUndefined();
    const opusEntry = findPrimaryLabelByAlias('llm-model:claude-opus-4-7');
    expect(opusEntry?.name).toBe('llm-model:claude-opus-5');
  });

  test('claude-sonnet-5 is the active sonnet label with delete false', () => {
    const label = findPrimaryLabel('llm-model:claude-sonnet-5');
    expect(label).toBeDefined();
    expect(label?.delete).toBe(false);
  });

  test('claude-sonnet-4-6 is an alias of claude-sonnet-5 enabling automatic migration of existing issues', () => {
    expect(findPrimaryLabel('llm-model:claude-sonnet-4-6')).toBeUndefined();
    const sonnetEntry = findPrimaryLabelByAlias('llm-model:claude-sonnet-4-6');
    expect(sonnetEntry?.name).toBe('llm-model:claude-sonnet-5');
  });

  test('each label name is unique among all primary names', () => {
    const primaryNames = labelEntries.map((entry) => entry.name);
    const uniqueNames = new Set(primaryNames);
    expect(primaryNames.length).toBe(uniqueNames.size);
  });
});
