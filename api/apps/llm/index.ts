import {
	AuthenticationApi,
	BackgroundJob,
	withContext
} from "wirejs-resources";
import { agenticHandler } from "./agentic-handler.js";
import { Infra } from "./infra.js";
export type { Chunk, ChunkData, Conversation, ConversationMessage } from './types.js';

export const LLM = (auth: AuthenticationApi) => {
	const infra = new Infra('app', 'llm', {
		systemPrompt: "You are a helpful assistant."
	});
	
	const chatRunner = new BackgroundJob('app', 'chatRunner', {
		handler: agenticHandler(infra)
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
			return infra.getHistory(room);
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