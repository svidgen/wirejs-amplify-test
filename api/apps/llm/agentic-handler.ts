import { Infra } from './infra.js'
import { cleanTitle, dedent } from './utils.js';
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

const assignConversationName = async (infra: Infra, conversationId: string, message: string) => {
	const titleResponse = await infra.prompt({
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
	context: string[],
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
				infra.prompt({ prompt: toolArgsFix(toolDecision!, lastError.stack) }) :
				infra.prompt({ prompt: toolDecisionPrompt(analysis, toolDescriptions) })
			)).content;

			console.log({ toolDecision });
			args = JSON.parse(toolDecision);

			console.log(args);

			if (args.should_act && standard[args.action_name]) {
				await infra.sendControlMessage(room, {
					type: 'status',
					status: `⚒️ Calling ${args.action_name} ...`
				});

				const toolResult = await standard[args.action_name].execute(...args.args);
				// NOTE! Here's where we potentially need chunked processing.

				const processedResult = (await infra.prompt({
					prompt: processToolResults(
						toolResult,
						args.instructions || "Summarize only if greater than 1000 words."
					)
				})).content;

				context.push(dedent`
					Performed ${args.action_name} with ${args.args} and instruction "${args.instructions}"
					and got result: ${processedResult}`
				);
				trimContext(context);

				return true;
			} else {
				if (args.guidance) {
					context.push(dedent`Updated Guidance: ${args.guidance}.`);
					trimContext(context);
				} else {
					context.push(dedent`Updated Guidance: Respond in character as you normally would.`);
					trimContext(context);
				}
				return false;
			}
		} catch (error: any) {
			lastError = error;
		}
	}
}

function trimContext(context: string[], maxChars: number = 8000) {
	context.reverse();
	while (JSON.stringify(context, null, 2).length > maxChars) {
		context.pop();
	}
	return context.reverse();
}

async function getContext(infra: Infra, room: string): Promise<string[]> {
	const conversation = await infra.getConversation(room);
	try {
		return JSON.parse(conversation?.context?.trim() || '[]')
	} catch {
		return [];
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
		let maxIterations = 5;

		const context = await getContext(infra, room);
		do {
			if (!hasTools) break;
		
			const requiresPlanningAnswer = await infra.prompt({
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

			const nextStepOutput = await infra.prompt({
				prompt: planningPrompt(context, toolDescriptions, transcript)
			});

			const analysis = nextStepOutput.content.trim();
			console.log({ analysis });
			const toolCalled = await handleToolCalling(infra, room, context, analysis, toolDescriptions);
			if (!toolCalled) break;
		} while (--maxIterations > 0);

		console.log('final context', context);
		await infra.updateConversationContext(room, JSON.stringify(context));

		// FINAL AGENT RESPONSE
		await infra.sendControlMessage(room, {
			type: 'status',
			status: `📝 Responding ...`
		});
		await infra.respond({
			conversationId: room,
			mid,
			prompt: generateNextMessagePrompt(context, transcript)
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