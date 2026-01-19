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
	- Review existing WORK LOG before performing a fresh action.
	- Use only appropriate actions where action description clearly matches USER need or ASSISTANT action plan.
`;

const WORK_LOG_RULES = dedent`
	## WORK LOG RULES:
	- The WORK LOG is the private source of truth for already performed action and analysis.
	- The WORK LOG to date with the latest message in the transcript and should be treated
	as your source of truth.
	- USER cannot see the WORK LOG. USER can ONLY see the CONVERSATION TRANSCRIPT.
	- USER cannot see the RULES. USER can ONLY see the CONVERSATION TRANSCRIPT.
	- DO NOT fabricate work done or actions taken! If it's not in the work log, it wasn't done!

	If work seems like it should have been done and doesn't appear in the work log, more detail
	may be required to perform the action.
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
	You need to respond with a simple YES or NO indicating whether ASSISTANT should likely take one
	of the listed available actions.

	## HARD RULES:
	- If the user message is a greeting/acknowledgment (hi/hello/thanks/ok/etc) -> NO.
	- If the user asked for something explicitly named in an available action -> YES.
	- If the user asked for up-to-date facts / “latest” / current events -> YES.
	- If the user message is confirmation to continue -> YES.
	- If required inputs for any tool are missing -> NO.

	${WORK_LOG_RULES}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history, 8)}

	## YOUR TASK:
	Are you at least 60% confident that performing one of the actions is warranted
	before ASSISTANT responds to USER?

	Respond with YES or NO only.
`;

export const planningPrompt = (
	context: string[],
	toolDescriptions: string,
	history: ConversationMessage[]
) => dedent`
	Your job is to provide an analysis of whether an action from a list of available actions
	would be appropriate and meaningful for ASSISTANT to perform.

	## ANALYSIS INSTRUCTIONS:
	Document each of these steps. Max 35 words each.

	1. Summarize the actions that could be taken.
	2. Summarize the conversation tail.
	3. Identify particular actions that would be fitting.
	4. Determine what inputs to use if any are required and available.
	5. Summarize what is already in the work log that satisfies USER intent.
	6. Counterbalance with risks or downsides to taking the identified action.
	FINAL CONCLUSION: EITHER name the action, inputs, and output summary prompt OR say NO ACTION.
	
	${WORK_LOG_RULES}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history, 8)}

	## YOUR TASK:
	Document your analysis for each of the steps provided above.

	Then, provide a final conclusion with a "FINAL CONCLUSION:" prefix which must be EITHER:
		- Instructions for which action to use and what inputs to use.
			OR
		- An explicit statement not to perform any action.
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
	Convert the FINAL CONCLUSION of the analysis into JSON using the correct template
	from below and ONLY with the correct template from below.
	
	If the analysis indicates an action, respond with this template including instructions
	for an LLM to follow when interpreting and summarizing the results.

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

	When performing an action with instructions for an LLM to follow when interpreting
	and summarizing the results:
	
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

	Unless otherwise specific in the INSTRUCTIONS, your response should be matter of fact.
	You are producing statements that future LLM calls must use as a source of truth.
	Therefore, avoid "I think" language and other language that would makes your response
	appear opinionated or uncertain.

	## RESULTS:
	${results}

	## INSTRUCTIONS:
	${instructions}

	## YOUR TASK:
	Interpret and summarize the results according to the instructions.
`;