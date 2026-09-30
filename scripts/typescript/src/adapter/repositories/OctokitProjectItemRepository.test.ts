import { OctokitProjectItemRepository } from './OctokitProjectItemRepository';

const createFakeGraphqlClient = (): { graphql: jest.Mock } => ({
  graphql: jest.fn(),
});

describe('OctokitProjectItemRepository', () => {
  describe('addItem', () => {
    test('resolves the added item id when the mutation succeeds', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        addProjectV2ItemById: { item: { id: 'PVTI_xxx' } },
      });
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.addItem({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBe('PVTI_xxx');
    });

    test('resolves null when the mutation response has a null item', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        addProjectV2ItemById: { item: null },
      });
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.addItem({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBeNull();
    });

    test('resolves null instead of rejecting when the graphql client rejects', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockRejectedValue(new Error('transient failure'));
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.addItem({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBeNull();
    });
  });

  describe('findExistingItemId', () => {
    test('resolves the id of the node whose project.id matches the given projectId, even when that node is not first in the list', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        node: {
          projectItems: {
            nodes: [
              { id: 'PVTI_other', project: { id: 'PVT_someOtherProject' } },
              { id: 'PVTI_yyy', project: { id: 'PVT_theProjectId' } },
            ],
          },
        },
      });
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.findExistingItemId({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBe('PVTI_yyy');
    });

    test('resolves null when no node matches the given projectId', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        node: {
          projectItems: {
            nodes: [
              { id: 'PVTI_other', project: { id: 'PVT_someOtherProject' } },
            ],
          },
        },
      });
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.findExistingItemId({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBeNull();
    });

    test('resolves null instead of rejecting when the graphql client rejects', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockRejectedValue(new Error('transient failure'));
      const repository = new OctokitProjectItemRepository(client);

      const itemId = await repository.findExistingItemId({
        projectId: 'PVT_theProjectId',
        contentNodeId: 'I_theContentNodeId',
      });

      expect(itemId).toBeNull();
    });
  });

  describe('getStatusFieldOptionName', () => {
    test('resolves the existing status option name', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        node: { fieldValueByName: { name: 'In Progress' } },
      });
      const repository = new OctokitProjectItemRepository(client);

      const statusName = await repository.getStatusFieldOptionName(
        'PVTI_xxx',
      );

      expect(statusName).toBe('In Progress');
    });

    test('resolves an empty string when no status field value is set', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        node: { fieldValueByName: null },
      });
      const repository = new OctokitProjectItemRepository(client);

      const statusName = await repository.getStatusFieldOptionName(
        'PVTI_xxx',
      );

      expect(statusName).toBe('');
    });

    test('rejects (does not swallow) when the graphql client rejects', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockRejectedValue(new Error('permanent failure'));
      const repository = new OctokitProjectItemRepository(client);

      await expect(
        repository.getStatusFieldOptionName('PVTI_xxx'),
      ).rejects.toThrow('permanent failure');
    });
  });

  describe('setStatusFieldOption', () => {
    test('resolves undefined when the mutation succeeds', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockResolvedValue({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_xxx' } },
      });
      const repository = new OctokitProjectItemRepository(client);

      await expect(
        repository.setStatusFieldOption({
          projectId: 'PVT_theProjectId',
          itemId: 'PVTI_xxx',
          fieldId: 'PVTSSF_theFieldId',
          optionId: 'theOptionId',
        }),
      ).resolves.toBeUndefined();
    });

    test('rejects (does not swallow) when the graphql client rejects', async () => {
      const client = createFakeGraphqlClient();
      client.graphql.mockRejectedValue(new Error('permanent failure'));
      const repository = new OctokitProjectItemRepository(client);

      await expect(
        repository.setStatusFieldOption({
          projectId: 'PVT_theProjectId',
          itemId: 'PVTI_xxx',
          fieldId: 'PVTSSF_theFieldId',
          optionId: 'theOptionId',
        }),
      ).rejects.toThrow('permanent failure');
    });
  });
});
