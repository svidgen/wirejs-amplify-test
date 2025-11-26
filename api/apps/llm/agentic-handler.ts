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
		if (line.toLowerCase().startsWith('act:')) {
			return line.substring('act:'.length);
		}
	}
}

function findGuidance(response: string) {
	for (const rawLine of response.split("\n")) {
		const line = rawLine.trim();
		if (line.toLowerCase().startsWith('hint:')) {
			return line.substring('hint:'.length);
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
		const transcript = history.map(h =>
			`${h.role.toUpperCase()}: ${h.content}`.replace(/\n|\r/g, ' ')
		).join('\n')
		const toolDescriptions = JSON.stringify(tools);

		// if we're just getting started, we want a user friendly conversation title.
		if (mid === 1) {
			await assignConversationName(infra, room, newUserMessage);
		}

		// AGENTIC LOOP
		let maxIterations = 3;

		// TODO: restore existing context
		const context: Record<string, string> = {};

		let analysis = 'Respond normally.'

		do {
			if (!hasTools) break;
			await infra.sendControlMessage(room, {
				type: 'status',
				status: "Planning ..."
			});
			const nextStepOutput = await infra.assist({
				prompt: dedent`
					Your job is analyze a transcript between USER and ASSISTANT. I will provide
					existing context, available actions, and the conversation transcript.
					You must tell me whether any of the AVAILABLE ACTIONS is warranted.

					## EXISTING CONTEXT:
					${JSON.stringify(context, null, 2)}

					## AVAILABLE ACTIONS:
					${toolDescriptions}

					## CONVERSATION TRANSCRIPT:
					${transcript}
					
					Write a brief analysis using this template:

					I have analyzed the transcript and considered existing context and the
					available tools. Here is my analysis:

					Summary of Context: ___
					Summary of Transcript: ___
					Potentially Relevant Actions: ___
					In conclusion, because ___, the most natural next step for ASSISTANT would be
					to (respond in character | use action ___ with arguments ___).
					In order to do this, ASSISTANT might need to know ___.
				`
			});
			try {
				analysis = nextStepOutput.content.trim();
				// const step = findInstruction(thinking);
				// const guidance = findGuidance(thinking);

				console.log({ analysis });

				const args = JSON.parse((await infra.assist({
					prompt: formatToolArguments(toolDescriptions, analysis)
				})).content) as string[];

				const key = JSON.stringify(args);

				if (standard[args[0]]) {
					await infra.sendControlMessage(room, {
						type: 'status',
						status: `Working ...`
					});

					const toolResult = await standard[args[0]].execute(...args.slice(1));

					// NOTE! Here's where we potentially need chunked processing.
					const processedResult = (await infra.assist({
						prompt: processToolResults(toolResult, key)
					})).content;

					context[key] = processedResult;
				} else {
					maxIterations = 0;
				}

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
				Your job is to generate the NEXT ASSISTANT message to send to USER.
				You are NOT speaking to me. I'm just a proxy!
				You are writing a reply that will be sent directly to the user.

				Do NOT mention the prepared context directly. Use it only for your reference.
				It is output prepared by a preprocessing agent.

				If the context is highly unusual or controversial and is relevant to your
				response, present it neutrally and without endorsing it.

				PREPARED CONTEXT:
				${JSON.stringify(context, null, 2)}

				PREPARED ANALYSIS:
				${analysis}

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