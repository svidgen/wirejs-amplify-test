import type { ToolCall } from 'wirejs-resources';
import { Infra } from './infra.js'
import { cleanTitle } from './utils.js';
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
		// respectful clients should lock the UI.
		// TODO: log status events so that newly connecting clients
		//   also know when the UI should be locked/unlocked.
		await infra.sendControlMessage(room, { type: 'start' });

		// now, we can get and save state
		const history = await infra.getHistory(room);
		let mid = history.length;
		history.push(await infra.addMessage(room, mid++, {
			role: 'user', content: newUserMessage
		}));

		// just getting started and need a conversation title.
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		let maxLoops = 10;
		let toolCalls: ToolCall[];
		let responseMid = 0;
		do {
			const tools = maxLoops > 0 ? standard : undefined;
			
			const response = await infra.respond({
				conversationId: room,
				history: history.filter(h => h.role !== 'step'),
				tools,
				mid: mid++
			});
			responseMid = response.mid;

			toolCalls = tools && tools.length > 0 ? response.tool_calls ?? [] : [];
			for (const call of toolCalls) {
				const name = call.function.name;
				const args = call.function.arguments;
				const callString = `${name}(${JSON.stringify(args)})`;

				// lets connected clients know we're doing a thing
				infra.sendControlMessage(room, {
					type: 'status',
					status: `⚒️ Calling ${callString}`.slice(0, 100) + '...'
				}, mid);
				try {
					const t = tools!.find(t => t.name === name);	
					if (!t) throw new Error(`${name} does not exist.`);
					const r = await t.execute(args);

					// let's future and connected clients know we did a thing
					history.push(await infra.addMessage(room, mid++, {
						role: 'step',
						content: `⚒️ Called ${callString}`.slice(0, 100) + '...',
					}, true));

					// makes tool results visible in the conversation history
					// to the agent.
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

			// lets connected clients know we're working on an actual
			// response now.
			await infra.sendControlMessage(room, {
				type: 'status',
				status: `📝 Responding ...`
			});

			maxLoops--;
		} while (toolCalls.length > 0);

		// tell connected clients we're done responding (unlock the UI).
		await infra.sendControlMessage(room, { type: 'end' }, responseMid);
		
	} catch (error) {
		console.error('=== LLM Error ===');
		console.error('LLM call failed:', error);

		await infra.sendControlMessage(room, {
			type: 'status',
			status: 'Internal Error. Please try again.'
		});
	}
};