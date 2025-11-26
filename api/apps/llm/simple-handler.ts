import { Infra } from './infra.js'
import { cleanTitle, dedent } from './utils.js';
import { generateConversationTitle } from './prompts.js';

const assignConversationName = async (infra: Infra, conversationId: string, message: string) => {
	const titleResponse = await infra.assist({
		prompt: generateConversationTitle(message),
	});
	const name = cleanTitle(titleResponse.content);
	console.log('name assigned', name, titleResponse);
	await infra.updateConversationName(conversationId, name);
}

export const agenticHandler = (infra: Infra) => async (
	room: string,
	newUserMessage: string
) => {
	try {
		// we can let the user know we're doing stuff immediately.
		await infra.sendControlMessage(room, { type: 'start' });

		// now, we can get and save state
		const history = await infra.getHistory(room);
		let mid = history.length;
		history.push(await infra.addMessage(room, mid++, 'user', newUserMessage));

		// if we're just getting started, we want a user friendly conversation title.
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		// we just ask the LLM to respond from its own "knowledge" and personality.
		await infra.respond({
			conversationId: room,
			history,
		});

		// finally, unlock the UI by letting it know we're done.
		await infra.sendControlMessage(room, { type: 'end' }, mid);
	} catch (error) {
		console.error('=== LLM Error ===');
		console.error('LLM call failed:', error);

		await infra.sendControlMessage(room, {
			type: 'status',
			status: 'Internal Error. Please try again.'
		});
	}
};