import { dedent } from "./utils.js";
import { ConversationMessage } from "./types.js";

function renderContext(context: string[]): string {
	return '## WORK LOG:\n\n' + context.map((entryText, idx) => [
		// `--- BEGIN WORK LOG ENTRY #${idx + 1} ---`,
		entryText,
		// `--- END WORK LOG ENTRY #${idx + 1} ---`
	].join('\n')).join('\n\n');
}

function renderTranscript(
	history: ConversationMessage[],
	tail: number = 0
) {
	const messages = tail > 0
		? [...history, `(Truncated to last ${tail} messages.)`].reverse().slice(0, tail).reverse()
		: history;
	return messages.map(m => typeof m === 'string' ? `\n${m}`
		: `${m.role.toUpperCase()}: ${m.content}`.replace(/\n|\r/g, ' ')
	).join('\n');
}

const ACTION_USAGE_RULES = dedent`
	## RULES FOR ACTIONS:

	- Review existing WORK LOG before performing a fresh action
	- Use only appropriate actions where action description clearly matches USER need or ASSISTANT action plan
`;

const WORK_LOG_RULES = dedent`
	## WORK LOG RULES:

	- The WORK LOG is the private source of truth for thoughts and actions already taken.
	- The WORK LOG to date with the latest message in the transcript and should be treated
	as your source of truth.
	- USER cannot see the WORK LOG. USER can ONLY see the CONVERSATION TRANSCRIPT.
	- DO NOT fabricate work done or actions taken! If it's not in the work log, it wasn't done!
`

const ARGUMENTS_EXPLANATION = dedent`
	The arguments property for each action will specified similar to this example:

	"arguments": {
		"title": {
			"type": "string",
			"description": "The title of the book."
		},
		"pages": {
			"type": "number",
			"description": "The number of pages to write."
		}
	}

	The description on each field describes what to put in the field. The type describes the
	data type to use. The full arguments property should be an object that mirrors the definition
	but whose types match the type fields. E.g.,

	"arguments": {
		"title": "The Big Brown Bear Book",
		"pages": 12
	}

	Note how the arguments definition indicates the types used in the arguments data.
`;

export const generateConversationTitle = (message: string) => dedent`
	You generate short, descriptive conversation titles based on the user's initial message.

	Rules:
		- Return ONLY the title text, nothing else
		- 3-6 words maximum
		- Capture the main topic or question
		- No quotes, no explanations

	Examples:
		- User asks about weather -> "Weather Information Request"
		- User asks to explain quantum physics -> "Quantum Physics Explanation"  
		- User asks for recipe help -> "Recipe Assistance"
		- User asks about programming -> "Programming Question"

	Here is the message:
		
	${message}
`;

export const shouldPlanPrompt =  (
	context: string[],
	toolDescriptions: string,
	history: ConversationMessage[]
) => dedent`
	You need to respond with a simple YES or NO indicating whether ASSISTANT should either take one
	of the listed available actions.

	${ACTION_USAGE_RULES}

	${WORK_LOG_RULES}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history, 8)}

	## YOUR TASK:
	Respond with YES or NO only. Should ASSISTANT perform one of the available actions?
`;

export const planningPrompt = (
	context: string[],
	toolDescriptions: string,
	history: ConversationMessage[]
) => dedent`
	Your job is to provide a brief analysis of which action from a list of available actions ASSISTANT
	should describe to USER or perform (if necessary).

	${ACTION_USAGE_RULES}

	${WORK_LOG_RULES}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history, 8)}

	## YOUR TASK:
	Think aloud. Then, respond EITHER with instructions for which action to use and what inputs to use
	OR directly state your conclusion not to perform an action.
`;

export const toolDecisionPrompt = (
	analysis: string,
	toolDescriptions: string,
) => dedent`
	Your job is to translate an analysis into JSON. Respond ONLY with valid JSON.
	Your full response will be parsed in full as written.

	${ARGUMENTS_EXPLANATION}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## ANALYSIS:
	${analysis}

	## YOUR TASK:
	Convert the conclusions of the analysis into JSON using the correct template
	from below and ONLY with the correct template from below.
	
	If the analysis indicates an action, respond with this template including instructions
	for a subordinate agent to follow when interpreting and summarizing the results.

	{
		"should_act": true,
		"action_name": "___",
		"arguments": { ___ },
		"instructions": "___"
	}

	Otherwise, respond with this template including any relevant thinking (guidance) for ASSISTANT:

	{
		"should_act": false,
		"guidance": "___"
	}

	Respond ONLY with the filled in JSON template nothing else.

	(Your response must be fully valid JSON and ONLY fully valid JSON.)
`;

export const toolArgsFix = (toolDecision: string, error: string) => dedent`
	An attempt to perform an action was made. However, something in the Previous Attempt
	was formatted incorrectly, a data type was incorrect, or similar issue. Your job is to
	fix the JSON action call definition.

	${ARGUMENTS_EXPLANATION}

	## PREVIOUS ATTEMPT:
	${toolDecision}

	## RESULTING ERROR:
	${error}

	## YOUR TASK:
	Determine what is wrong with the Previous Attempt. Then, respond with the corrected
	template and ONLY the corrected template.

	Reminder: A correct response will be valid JSON using one of these two templates.

	When performing an action with instructions for a subordinate
	agent to follow when interpreting and summarizing the results:
	
	{
		"should_act": true,
		"action_name": "___",
		"arguments": { ___ },
		"instructions": "___"
	}

	When responding normally with relevant thinking (guidance) for ASSISTANT:

	{
		"should_act": false,
		"guidance": "___"
	}

	Respond ONLY with a new (corrected) JSON template and nothing else.

	(Your response must be fully valid JSON and ONLY fully valid JSON.)
`;

export const generateNextMessagePrompt = (
	context: string[],
	history: ConversationMessage[]
) => dedent`
	Your task is to write the next message from ASSISTANT to USER in the conversation
	transcript below.

	${WORK_LOG_RULES}

	You must only the next message and ONLY the next message to USER.
	Your response will be appended 100% as you have written it into the transcript.

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history)}

	## YOUR TASK:
	Write the next most fitting message from ASSISTANT to USER.
`;

export const processToolResults = (results: string, instructions: string) => dedent`
	Your job is to interpret and summarize the result of an action that has been
	performed according to some specific instructions.

	## RESULTS:
	${results}

	## INSTRUCTIONS:
	${instructions}

	## YOUR TASK:
	Interpret and summarize the results according to the instructions.
`;