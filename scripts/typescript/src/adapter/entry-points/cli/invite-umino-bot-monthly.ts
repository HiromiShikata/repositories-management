import { OctokitUminoBotCollaboratorRepository } from '../../repositories/OctokitUminoBotCollaboratorRepository';
import { UminoBotCollaboratorInviteUseCase } from '../../../domain/usecases/UminoBotCollaboratorInviteUseCase';

const run = async () => {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN environment variable is not set');
  }
  if (!process.env.UMINO_BOT_TOKEN) {
    throw new Error('UMINO_BOT_TOKEN environment variable is not set');
  }

  const repository = new OctokitUminoBotCollaboratorRepository('HiromiShikata');
  const useCase = new UminoBotCollaboratorInviteUseCase(repository);
  await useCase.run();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
