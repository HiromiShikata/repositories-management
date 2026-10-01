export interface ProjectItemRepository {
  addItem: (params: {
    projectId: string;
    contentNodeId: string;
  }) => Promise<string | null>;
  findExistingItemId: (params: {
    projectId: string;
    contentNodeId: string;
  }) => Promise<string | null>;
  getStatusFieldOptionName: (itemId: string) => Promise<string>;
  setStatusFieldOption: (params: {
    projectId: string;
    itemId: string;
    fieldId: string;
    optionId: string;
  }) => Promise<void>;
}
