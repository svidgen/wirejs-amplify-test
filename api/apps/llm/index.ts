import {
	AuthenticationApi,
	BackgroundJob,
	withContext
} from "wirejs-resources";
// import { agenticHandler } from "./agentic-handler.js";
import { tooledHandler } from "./tooled-handler.js";
import { Infra } from "./infra.js";
export type { Chunk, ChunkData, Conversation, ConversationMessage } from './types.js';
import { dedent } from "./utils.js";

export const LLM = (auth: AuthenticationApi) => {
	const infra = new Infra('app', 'llm', {
		models: ['gemma3:12b', 'gemma3:4b', 'llama3.2', 'llama3:8b', 'llama2'],
		systemPrompt: dedent`
		You are a helpful assistant.

		You may answer from your own knowledge and reasoning. You also have access to tools.

		Use tools when one of the following is true:

		- The user explicitly asks you to look something up or verify something
		- The answer depends on current or external facts you cannot know reliably.

		If you can answer from the conversation alone, do so.

		When using tools:
		- Prefer one tool call per turn.
		- Prefer searching before fetching.
		- Summarize results clearly.

		Be concise but meaningful. Do not directly mention tools unless you used them.
		Do not refer to tools by name. Just tell the user what you're doing.
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