export const PROJECT_AUTOMATION_EXCLUDED_REPOSITORIES: string[] = [
  'HiromiShikata/test-repository',
];

export const projectAutomationRepositoryGuard = (
  repositoryFullName: string,
): string => `github.repository != '${repositoryFullName}'`;
