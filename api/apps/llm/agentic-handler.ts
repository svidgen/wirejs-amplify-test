import { Infra } from './infra.js'
import { pad, cleanTitle } from './utils.js';
import { generateConversationTitle } from './prompts.js';

const assignConversationName = async (infra: Infra, conversaidId: string, message: string) => {
	const titleResponse = await infra.assist({
		systemPrompt: generateConversationTitle(message),
		history: []
	});
	const name = cleanTitle(titleResponse.content);
	await infra.updateConversationName(conversaidId, name);
}

export const agenticHandler = (infra: Infra, systemPrompt: string) => async (
	room: string,
	newUserMessage: string
) => {
	try {
		const history = await infra.getHistory(room);
		history.push(await infra.addMessage(room, history.length, 'user', newUserMessage));
		let mid = history.length;

		// If this is the first message (new conversation), save it with timestamped title
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		await infra.sendControlMessage(room, { type: 'start' });

		const result = await infra.respond({
			conversationId: room,
			history,
			systemPrompt
		});

		// Add assistant response to working history
		// history.push(result);

		await infra.sendControlMessage(room, { type: 'end' });

	} catch (error) {
		console.error('=== LLM Error ===');
		console.error('LLM call failed:', error);

		await infra.sendControlMessage(room, {
			type: 'status',
			status: 'Internal Error. Please try again.'
		});
	}
};