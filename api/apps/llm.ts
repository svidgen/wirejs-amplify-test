import {
	AuthenticationApi,
	BackgroundJob,
	RealtimeService,
	User,
	LLM as LLMResource,
	LLMMessage,
	withContext
} from "wirejs-resources";

export type Message = '**start**' | '**end**' | LLMMessage;

const llm = new LLMResource('app', 'llm', { 
	models: ['meta.llama3-2-90b-instruct-v1:0', 'llama3.2', 'llama3:8b', 'llama2']
});
const llmRealtimeService = new RealtimeService<Message>('app', 'llm');

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, history: LLMMessage[]) => {
		await llmRealtimeService.publish(room, [`**start**`]);
		await llm.continueConversation([
			{ role: 'system', content: 'You are a helpful (but generally concise) assistant.'},
			...history
		], chunk => {
			llmRealtimeService.publish(room, [chunk.message]);
		})
		await llmRealtimeService.publish(room, [`**end**`]);
	}
});


const assertIsAuthorized = (user: User, room: string) => {
	if (!room.startsWith(`${user.id}/`)) {
		throw new Error("Not authorized");
	}
}

export const LLM = (auth: AuthenticationApi) => withContext(context => ({
	async send(room: string, history: LLMMessage[]) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		if (!room || !history || !history.length) {
			throw new Error('Room and history are required');
		}
		await chatRunner.start(room, history);
	},
	async getRoom(room: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		return llmRealtimeService.getStream(context, room);
	},
	async createRoom() {
		const user = await auth.requireCurrentUser(context);
		const id = crypto.randomUUID();
		return `${user.id}/${id}`;
	}
}));