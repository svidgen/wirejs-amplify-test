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
	Each action specifies an "arguments" property and describes the JSON data type to use you must
	populate in the field when specifying the action. The "description" field indicates when or how
	you should populate the field.

	When populating arguments, you must match the intended inputs to the appropriate action field
	and write it using the correct JSON type.

	IMPORTANT: DO NOT LITERALLY ECHO THE "arguments" FROM THE ACTION DEFINITION.

	That would be silly. Instead, when argument "x" specifies type "string", you MUST include
	in your "arguments" object an "x" field set to an appropriate string. For a field with a type
	of "number", you MUST set it to a number.
`;

const ACTION_CALL_RULES = dedent`
	If the analysis indicates action, respond with this template:
	
	{
		"should_act": true,
		"action_name": "___",
		"arguments": { ___ },
		"instructions": "___"
	}

	When responding normally, respond with this template where "guidance" is optional steering
	for future response generation:

	{
		"should_act": false,
		"guidance": "___"
	}

	## RULES:

	- Respond with a correct JSON template ONLY and nothing else.
	- DO NOT ADD MARKDOWN.
	- DO NOT ADD COMMENTARY.
	- DO NOT WRAP YOUR RESPONSE IN CODE FENCES, BACKTICKS, OR TILDE CHARACTERS.
	- Respond with raw JSON.

	The first character of your response must STRICTLY be left bracket: {
	The last character of your response must strictly be right bracket: }
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
	Your job is decide whether an action from a list of available actions
	would be appropriate and meaningful before ASSISTANT responds to USER.

	## ANALYSIS INSTRUCTIONS:
	Follow these steps (max 35 words each):

	Step 1: Describe the USER intent from the tail of the transcript in one short sentence.
	(If unclear, say "unclear".)

	Step 2: State the action that would satisfy the intent.
	(If none are relevant, say "none".)

	Step 3: State whether the implied action was already done according to the WORK LOG.
	(Say "yes", "no", or "not applicable" followed by one sentence indicating evidence from WORK LOG.)

	Step 4: If an action is still needed to satisfy intent, give the required input values.
	(If inputs are not clear and obvious, say "inputs missing". If choosing no action, say "not applicable".)

	Step 5: Explain what ASSISTANT needs to know from the results of the action.
	(If choosing no action, say "not applicable".)

	Step 6: Clearly state whether ASSISTANT should actually perform the action.
	("yes" or "no". Choose "no" if already completed or WORK LOG contains sufficient context per user intent.)

	${WORK_LOG_RULES}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history, 8)}

	## YOUR TASK:
	Perform the analysis.
`;

export const toolDecisionPrompt = (
	analysis: string,
	toolDescriptions: string,
) => dedent`
	Your job is to translate an analysis into JSON. Respond ONLY with valid JSON.
	Your full response will be parsed in full as written.

	${ACTION_CALL_RULES}

	${ARGUMENTS_EXPLANATION}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## ANALYSIS:
	${analysis}

	## YOUR TASK:
	Convert the analysis into JSON using the correct template.
`;

export const toolArgsFix = (toolDecision: string, error: string) => dedent`
	An attempt to perform an action was made. However, something in the Previous Attempt
	was formatted incorrectly, a data type was incorrect, or similar issue. Your job is to
	fix the JSON action call definition.

	${ACTION_CALL_RULES}

	${ARGUMENTS_EXPLANATION}

	## PREVIOUS ATTEMPT:
	${toolDecision}

	## RESULTING ERROR:
	${error}

	## YOUR TASK:
	Review the errors from the Previous Attempt and respond with the corrected template.
`;

export const generateNextMessagePrompt = (
	context: string[],
	history: ConversationMessage[],
	guidance: string
) => dedent`
	Your task is to write the next message from ASSISTANT to USER in the conversation
	transcript below.

	${WORK_LOG_RULES}

	You must only the next message and ONLY the next message to USER.
	Your response will be forwarded 100% as you have written to USER.

	${renderContext(context)}

	## GUIDANCE:
	${guidance}

	## CONVERSATION TRANSCRIPT:
	${renderTranscript(history)}

	## YOUR TASK:
	Write the next message from ASSISTANT to USER.

	Reminder: USER can only see messages under CONVERSATION TRANSCRIPT and DO NOT mention the WORK LOG.
`;

export const processToolResults = (
	results: string,
	instructions: string = "Return the results. If greater than 500 words, summarize results first."
) => dedent`
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
	Respond according to the instructions above.
`;