import type { ToolCall } from 'wirejs-resources';
import { Infra } from './infra.js'
import { cleanTitle, dedent } from './utils.js';
import { generateConversationTitle } from './prompts.js';
import { standard } from './tools.js';

const assignConversationName = async (infra: Infra, conversationId: string, message: string) => {
	const titleResponse = await infra.prompt({
		prompt: generateConversationTitle(message),
	});
	const name = cleanTitle(titleResponse.content);
	console.log('name assigned', name, titleResponse);
	await infra.updateConversationName(conversationId, name);
}

export const tooledHandler = (infra: Infra) => async (
	room: string,
	newUserMessage: string,
) => {
	try {
		// we can let the user know we're doing stuff immediately.
		await infra.sendControlMessage(room, { type: 'start' });

		// now, we can get and save state
		const history = await infra.getHistory(room);
		let mid = history.length;
		history.push(await infra.addMessage(room, mid++, {
			role: 'user', content: newUserMessage
		}));

		// if we're just getting started, we want a user friendly conversation title.
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		let maxLoops = 10;
		let toolCalls: ToolCall[];
		do {
			const tools = maxLoops > 0 ? standard : undefined;
			
			const response = await infra.respond({
				conversationId: room,
				history,
				tools,
				mid: mid++
			});

			toolCalls = tools && tools.length > 0 ? response.tool_calls ?? [] : [];
			for (const call of toolCalls) {
				const name = call.function.name;
				const args = call.function.arguments;
				try {
					const t = tools!.find(t => t.name === name);	
					if (!t) throw new Error(`${name} does not exist.`);
					const r = await t.execute(args);
					history.push(await infra.addMessage(room, mid++, {
						role: 'tool',
						tool_name: name,
						tool_call_id: call.id || JSON.stringify([name, args]),
						content: JSON.stringify(r, null, 2),
					}));
				} catch (error) {
					history.push(await infra.addMessage(room, mid++, {
						role: 'tool',
						tool_name: name,
						tool_call_id: call.id || JSON.stringify([name, args]),
						content: String(error),
					}))
				}
			}

			maxLoops--;
		} while (toolCalls.length > 0);

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