import {
	AuthenticationApi,
	BackgroundJob,
	RealtimeService,
	User,
	withContext
} from "wirejs-resources";

export type LLMMessage = '**start**' | '**end**' | {
	role: string;
	content: string;
};

const llmRealtimeService = new RealtimeService<LLMMessage>('app', 'llm');
const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: chatOllama
});

async function doStream(response: Response, room: string) {
	if (!response.ok || !response.body) {
		throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8');

	let message: string = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		const chunk = decoder.decode(value, { stream: true });
		const chunkMessage = JSON.parse(chunk).message;
		await llmRealtimeService.publish(room, [chunkMessage]);
		message += chunkMessage;
	}
	return message;
}

async function chatOllama(room: string, history: LLMMessage[]) {
	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'llama3.2',
			// model: 'mistral',
			// model: 'smollm',
			messages: [
				{ role: 'system', content: 'You are a helpful assistant.' },
				...history
			],
			stream: true
		})
	});
	await llmRealtimeService.publish(room, [`**start**`]);
	await doStream(response, room);
	await llmRealtimeService.publish(room, [`**end**`]);
}

const assertIsAuthorized = (user: User, room: string) => {
	if (!room.startsWith(`${user.id}-`)) {
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
		chatRunner.start(room, history);
	},
	async getRoom(room: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		return llmRealtimeService.getStream(context, room);
	},
	async createRoom() {
		const user = await auth.requireCurrentUser(context);
		const id = crypto.randomUUID();
		return `${user.id}-${id}`.slice(0, 50); // max RT channel size
	}
}));