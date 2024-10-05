export interface SlackRepository {
    postDirectMessage(project: string, userId: string, message: string): Promise<void>;

}