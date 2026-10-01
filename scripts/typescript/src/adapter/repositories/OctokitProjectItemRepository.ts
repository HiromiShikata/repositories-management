import { ProjectItemRepository } from '../../domain/usecases/adapter-interfaces/ProjectItemRepository';

export interface ProjectItemGraphqlClient {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

type AddProjectV2ItemByIdResponse = {
  addProjectV2ItemById: { item: { id: string } | null };
};

type ProjectItemsNode = {
  id: string;
  project: { id: string };
};

type FindExistingItemIdResponse = {
  node: {
    projectItems: {
      nodes: ProjectItemsNode[];
    };
  } | null;
};

type GetStatusFieldOptionNameResponse = {
  node: {
    fieldValueByName: { name: string } | null;
  } | null;
};

export class OctokitProjectItemRepository implements ProjectItemRepository {
  constructor(private readonly graphqlClient: ProjectItemGraphqlClient) {}

  async addItem(params: {
    projectId: string;
    contentNodeId: string;
  }): Promise<string | null> {
    try {
      const response =
        await this.graphqlClient.graphql<AddProjectV2ItemByIdResponse>(
          'mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}',
          { projectId: params.projectId, contentId: params.contentNodeId },
        );
      return response.addProjectV2ItemById.item?.id ?? null;
    } catch (error) {
      console.error('addProjectV2ItemById failed:', error);
      return null;
    }
  }

  async findExistingItemId(params: {
    projectId: string;
    contentNodeId: string;
  }): Promise<string | null> {
    try {
      const response =
        await this.graphqlClient.graphql<FindExistingItemIdResponse>(
          'query($nodeId:ID!){node(id:$nodeId){...on PullRequest{projectItems(first:10){nodes{id project{id}}}}...on Issue{projectItems(first:10){nodes{id project{id}}}}}}',
          { nodeId: params.contentNodeId },
        );
      const matchingNode = (response.node?.projectItems.nodes ?? []).find(
        (node) => node.project.id === params.projectId,
      );
      return matchingNode?.id ?? null;
    } catch (error) {
      console.error('projectItems fallback lookup failed:', error);
      return null;
    }
  }

  async getStatusFieldOptionName(itemId: string): Promise<string> {
    const response =
      await this.graphqlClient.graphql<GetStatusFieldOptionNameResponse>(
        'query($itemId:ID!){node(id:$itemId){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
        { itemId },
      );
    return response.node?.fieldValueByName?.name ?? '';
  }

  async setStatusFieldOption(params: {
    projectId: string;
    itemId: string;
    fieldId: string;
    optionId: string;
  }): Promise<void> {
    await this.graphqlClient.graphql(
      'mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}',
      {
        projectId: params.projectId,
        itemId: params.itemId,
        fieldId: params.fieldId,
        optionId: params.optionId,
      },
    );
  }
}
