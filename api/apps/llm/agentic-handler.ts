import { Infra } from './infra.js'
import { cleanTitle, dedent } from './utils.js';
import { generateConversationTitle, formatToolArguments, processToolResults } from './prompts.js';
import { standard } from './tools.js';

const assignConversationName = async (infra: Infra, conversationId: string, message: string) => {
	const titleResponse = await infra.assist({
		prompt: generateConversationTitle(message),
	});
	const name = cleanTitle(titleResponse.content);
	console.log('name assigned', name, titleResponse);
	await infra.updateConversationName(conversationId, name);
}

const tools = standard;
const hasTools = Object.keys(tools).length > 0;

function findInstruction(response: string) {
	for (const rawLine of response.split("\n")) {
		const line = rawLine.trim();
		if (line.toLowerCase().startsWith('yes:')) {
			return line.substring('yes:'.length);
		}
	}
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

		// context blocks for sub-agents
		const transcript = history.map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n')
		const toolDescriptions = Object.entries(tools)
			.map(([name, def]) => `### ${name}:\n${def.description}`)
			.join('\n\n---\n\n');
		const toolUsages = Object.entries(tools)
			.map(([name, def]) => `### ${name}\n\nARGUMENTS:\n\n${def}`)
			.join('\n\n---\n\n');

		// if we're just getting started, we want a user friendly conversation title.
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		// AGENTIC LOOP
		let maxIterations = 3;

		// TODO: restore existing context
		const context: Record<string, string> = {};
		do {
			if (!hasTools) break;
			await infra.sendControlMessage(room, {
				type: 'status',
				status: "Planning ..."
			});
			const nextStepOutput = await infra.assist({
				prompt: dedent`
					Hi. I need you to analyze a conversation. Review the following:

					1. Conversation
					2. Completed actions
					3. Available actions

					THEN complete your assigned task.

					## CONVERSATION:
					${transcript}

					## EXISTING CONTEXT:
					${JSON.stringify(context, null, 2)}

					## AVAILABLE ACTIONS:
					${toolDescriptions}

					# YOUR TASK:
					Tell me if the transcript strongly warrants the use of any of the previously
					listed AVAILABLE ACTIONS. If so, please respond with "YES: use ACTION_NAME
					with parameters X... to do Y". Start your decision line with "YES:" and be
					sure to include the tool name directly.

					Otherwise, you can conclude with something like "NO: no actions are needed".
					
					Feel free to think aloud.
				`
			});
			try {
				const thinking = nextStepOutput.content.trim();
				const step = findInstruction(thinking);
				console.log({ thinking, step });

				if (!step) break;

				await infra.sendControlMessage(room, {
					type: 'status',
					status: `Working on ${step.substring(0, 20)} ...`
				});
				const args = JSON.parse((await infra.assist({
					prompt: formatToolArguments(toolUsages, step)
				})).content) as string[];
				const toolResult = await standard[args[0]].execute(...args.slice(1));

				// NOTE! Here's where we potentially need chunked processing.
				const processedResult = (await infra.assist({
					prompt: processToolResults(toolResult, step)
				})).content;

				context[step] = processedResult;

				// TODO: save existing context
			} catch {
				// meh
			}
		} while (--maxIterations > 0);

		console.log('final context', context);

		// FINAL AGENT RESPONSE
		await infra.sendControlMessage(room, {
			type: 'status',
			status: `Writing ...`
		})
		await infra.respond({
			conversationId: room,
			mid,
			prompt: dedent`
				Your job is to generate the NEXT assistant message to send to USER.
				You are NOT speaking to me. I'm just a proxy!
				You are writing a reply that will be sent directly to the user.

				Do NOT mention the prepared context directly. Use it only for your reference.
				It is output prepared by a preprocessing agent.

				If the context is highly unusual or controversial and is relevant to your
				response, present it neutrally and without endorsing it.

				PREPARED CONTEXT:
				${JSON.stringify(context, null, 2)}

				CONVERSATION:
				${transcript}

				TASK:
				Generate ASSISTANT's next message to the user.
				Keep it friendly. Output only the message text.
				No additional formatting. Just the next message.
			`
		});
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