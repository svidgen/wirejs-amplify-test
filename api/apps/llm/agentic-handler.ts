import { Infra } from './infra.js'
import { cleanTitle } from './utils.js';
import {
	generateConversationTitle,
	generateNextMessagePrompt,
	planningPrompt,
	processToolResults,
	toolDecisionPrompt,
	toolArgsFix,
	shouldPlanPrompt,
} from './prompts.js';
import { standard } from './tools.js';
import { LLMMessage } from 'wirejs-resources';

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

async function handleToolCalling(
	infra: Infra,
	room: string,
	context: Record<string, string>,
	analysis: string,
	toolDescriptions: string,
) {
	let lastError: any = undefined;
	let maxAttempts = 10;
	let args: any;
	let toolDecision: string = '{}';
	while (maxAttempts-- >= 0) {
		try {
			toolDecision = (await (lastError ?
				infra.assist({ prompt: toolArgsFix(toolDecision!, lastError.stack) }) :
				infra.assist({ prompt: toolDecisionPrompt(analysis, toolDescriptions) })
			)).content;

			console.log({ toolDecision });
			args = JSON.parse(toolDecision);

			console.log(args);

			const key = JSON.stringify([args.tool_name, args.args]);

			if (args.should_call_tool && standard[args.tool_name]) {
				await infra.sendControlMessage(room, {
					type: 'status',
					status: `Working ...`
				});

				const toolResult = await standard[args.tool_name].execute(...args.args);
				// NOTE! Here's where we potentially need chunked processing.

				const processedResult = (await infra.assist({
					prompt: processToolResults(toolResult, key)
				})).content;

				context[key] = processedResult;

				return true;
			} else {
				return false;
			}
		} catch (error: any) {
			lastError = error;
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
		let titlePromise: Promise<any> | undefined = undefined;
		if (mid === 1) {
			titlePromise = assignConversationName(infra, room, newUserMessage);
		}

		// AGENTIC LOOP
		let maxIterations = 3;

		// TODO: restore existing context
		const context: Record<string, string> = {};

		let guidance = 'Respond normally.'

		do {
			if (!hasTools) break;
		
			const requiresPlanningAnswer = await infra.assist({
				prompt: shouldPlanPrompt(context, toolDescriptions, transcript)
			});
			console.log({ requiresPlanningAnswer });
			const answer = requiresPlanningAnswer.content.trim().toLocaleLowerCase();
			if (!(answer.startsWith('yes') || answer.startsWith('"yes'))) {
				break;
			}
			
			await infra.sendControlMessage(room, {
				type: 'status',
				status: "💫 Thinking for a better answer ..."
			});

			const nextStepOutput = await infra.assist({
				prompt: planningPrompt(context, toolDescriptions, transcript)
			});

			const analysis = nextStepOutput.content.trim();
			console.log({ analysis });
			const toolCalled = await handleToolCalling(infra, room, context, analysis, toolDescriptions);
			if (!toolCalled) break;
			// TODO: save existing context
		} while (--maxIterations > 0);

		console.log('final context', context);

		// FINAL AGENT RESPONSE
		await infra.sendControlMessage(room, {
			type: 'status',
			status: `📝 Responding ...`
		});
		await infra.respond({
			conversationId: room,
			mid,
			prompt: generateNextMessagePrompt(context, guidance, transcript)
		});
		await titlePromise;
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