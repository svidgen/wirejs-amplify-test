import {
	AuthenticationApi,
	BackgroundJob,
	LLM as LLMService,
	LLMMessage,
	LLMChunk,
	RealtimeService,
	Setting,
	User,
	withContext
} from "wirejs-resources";
import { randomUUID } from 'crypto';

export type Chunk = {
	mid: string;
	seq: number;
	pad: string; // security padding
	data: '**start**' | '**end**' | MinimalChunk;
}

export type Message = LLMMessage;

export type MinimalChunk = {
	text: string;
};

const modelsOverride = new Setting('app', 'models', {
	private: false,
	init: () => 'llama3.2, llama3:8b, llama2'
});

const llm = new LLMService('app', 'llm', { 
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: 'You are a helpful (but generally concise) assistant.'
});
const llmRealtimeService = new RealtimeService<Chunk>('app', 'llm');

const pad = () => randomUUID().slice(0, 1 + Math.floor(Math.random() * 16));

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, history: LLMMessage[]) => {
		const overrides = (await modelsOverride.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) llm.models = overrides;
		const mid = randomUUID();
		let seq = 0;
		let batch: string[] = [];
		let lastBatch = new Date().getTime();
		await llmRealtimeService.publish(room, [{
			mid,
			seq: seq++,
			pad: pad(),
			data: `**start**`
		}]);
		await llm.continueConversation(
			[ ...history ],
			async chunk => {
				batch.push(chunk.message.content);
				if (new Date().getTime() - lastBatch > 150) {
					const text = batch.join('');
					batch = [];
					await llmRealtimeService.publish(room, [{
						mid,
						seq: seq++,
						pad: pad(),
						data: { text }
					}]);
					lastBatch = new Date().getTime();
				}
			}
		);
		if (batch.length > 0) {
			const text = batch.join('');
			await llmRealtimeService.publish(room, [{
				mid,
				seq: seq++,
				pad: pad(),
				data: { text }
			}]);
		}
		await llmRealtimeService.publish(room, [{
			mid,
			seq,
			pad: pad(),
			data: `**end**`
		}]);
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