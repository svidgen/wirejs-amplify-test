import { BackgroundJob, RealtimeService, withContext } from "wirejs-resources";

const llmRealtimeService = new RealtimeService('app', 'llm');
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
		await llmRealtimeService.publish(room, [`**chunk:** ${chunk}`]);
		message += chunk;
	}

	await llmRealtimeService.publish(room, [`**done:** ${message}`]);
}

async function chatOllama(room: string, prompt: string, history: string[] = []) {
	const response = await fetch('http://localhost:11434/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'llama3.2',
			messages: [
				...history,
				{ role: 'user', content: prompt }
			],
			stream: true
		})
	});
	await doStream(response, room);
}

export const LLM = () => withContext(_context => ({
	async send(room: string, prompt: string, history: string[] = []) {
		if (!room || !prompt) {
			throw new Error('Room and prompt are required');
		}
		chatRunner.start(room, prompt, history);
	},
	async getRoom(room: string) {
		return llmRealtimeService.getStream(room);
	}
}));