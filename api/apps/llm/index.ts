import {
	AuthenticationApi,
	BackgroundJob,
	withContext
} from "wirejs-resources";
// import { agenticHandler } from "./agentic-handler.js";
import { tooledHandler } from "./tooled-handler.js";
import { Infra } from "./infra.js";
export type { Chunk, ChunkData, Conversation, ConversationMessage, Role } from './types.js';
import { dedent } from "./utils.js";

export const LLM = (auth: AuthenticationApi) => {
	const infra = new Infra('app', 'llm', {
		models: ['gemma3:12b', 'gemma3:4b', 'llama3.2', 'llama3:8b', 'llama2'],
		systemPrompt: dedent`
		You are a helpful assistant.
		`
	});

	const chatRunner = new BackgroundJob('app', 'chatRunner', {
		handler: tooledHandler(infra)
	});

	return withContext(context => ({
		async send(room: string, message: string) {
			const user = await auth.requireCurrentUser(context);
			await infra.assertUserIsAuthorized(user, room);
			if (!room || !message || !message.trim()) {
				throw new Error('Room and message are required');
			}
			await chatRunner.start(room, message.trim());
		},
		async getRoom(room: string) {
			const user = await auth.requireCurrentUser(context);
			await infra.assertUserIsAuthorized(user, room);
			return infra.getStream(context, room);
		},
		async getHistory(room: string) {
			const user = await auth.requireCurrentUser(context);
			await infra.assertUserIsAuthorized(user, room);
			const history = await infra.getHistory(room);
			return history.filter(m => [
				'assistant', 'user', 'step'
			].includes(m.role) && !!m.content);
		},
		async createRoom() {
			const user = await auth.requireCurrentUser(context);
			const conversation = await infra.createConversation(user);
			return conversation.conversationId;
		},
		async getConversations() {
			const user = await auth.requireCurrentUser(context);
			return infra.listUserConversations(user);
		},
		async deleteConversation(conversationId: string) {
			const user = await auth.requireCurrentUser(context);
			await infra.assertUserIsAuthorized(user, conversationId);
			await infra.deleteConversation(conversationId)
			return { success: true };
		}
	}))
};