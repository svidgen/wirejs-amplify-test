import { BackgroundJob, RealtimeService, withContext } from "wirejs-resources";

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

	// let message: string = '';
	await llmRealtimeService.publish(room, [`**start**`]);

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		const chunk = decoder.decode(value, { stream: true });
		const message = JSON.parse(chunk).message;
		await llmRealtimeService.publish(room, [message]);
		// message += chunk;
	}

	await llmRealtimeService.publish(room, [`**end**`]);
	// await llmRealtimeService.publish(room, [`**done:** ${message}`]);
}

async function chatOllama(room: string, history: LLMMessage[]) {
	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			// model: 'llama3.2',
			model: 'mistral',
			// model: 'smollm',
			messages: [
				{ role: 'system', content: 'You are a helpful assistant.' },
				...history
			],
			stream: true
		})
	});
	await doStream(response, room);
}

export const LLM = () => withContext(_context => ({
	async send(room: string, history: LLMMessage[]) {
		if (!room || !history || !history.length) {
			throw new Error('Room and history are required');
		}
		chatRunner.start(room, history);
	},
	async getRoom(room: string) {
		return llmRealtimeService.getStream(room);
	}
}));