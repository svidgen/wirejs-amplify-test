import { dedent } from "./utils.js";

function renderContext(context: string[]): string {
	return '## ACTION LOG:\n\n' + context.map((entryText, idx) => [
		`--- BEGIN LOG ENTRY #${idx + 1} ---`,
		entryText,
		`--- END LOG ENTRY ${idx + 1} ---`
	].join('\n')).join('\n\n');
}

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
	transcript: string
) => dedent`
	I will provide a log of actions already taken (if any) and a conversation transcript.

	I need you to then respond with a simple YES or NO indicating whether any action is indicated.

	(Also respond YES if USER has asked what the ASSISTANT can do for them and ASSISTANT does not
	already know from the conversation transcript.)

	${renderContext(context)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}
`;

export const planningPrompt = (
	context: string[],
	toolDescriptions: string,
	transcript: string
) => dedent`
	I will provide a log of actions already taken (if any), list of available actions (if any), and a
	conversation transcript.

	You must provide a brief analysis indicating whether an action from the list
	of available actions is warranted.

	Think aloud in your analysis and conclude with a brief and clear concluding statement as
	to which action should be taken (if any).

	If no action from the list is warranted, state this directly and provide brief guidance
	for how to respond to the user.

	${renderContext(context)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}
`;

export const toolDecisionPrompt = (
	analysis: string,
	toolDescriptions: string,
) => dedent`
	## Analysis
	${analysis}

	## Available Actions
	${toolDescriptions}

	## Your Job
	Convert the conclusions of the analysis into JSON using the correct template
	from below and ONLY with the correct template from below.
	
	If the analysis indicates an action, respond with this template including instructions
	for a subordinate agent to follow when interpreting and summarizing the results.

	{
		"should_act": true,
		"action_name": "___",
		"args": [___, ...],
		"instructions": "___"
	}

	Otherwise, respond with this template including any relevant guidance for responding:

	{
		"should_act": false,
		"guidance": "___"
	}

	Respond ONLY with the filled in JSON template nothing else.

	(Your response must be fully valid JSON and ONLY fully valid JSON.)
`;

export const toolArgsFix = (toolDecision: string, error: string) => dedent`
	An attempt to perform an action was made. However, something in the Previous Attempt
	was formatted incorrectly, a data type was incorrect, or similar issue.

	## Previous Attempt
	${toolDecision}

	## Resulting Error
	${error}

	## Your Job
	Determine what is wrong with the Previous Attempt. Then, respond with the corrected
	template and ONLY the corrected template.

	A correct response will be valid JSON using one of these two templates.

	When performing an action with instructions for a subordinate
	agent to follow when interpreting and/or summarizing the results:
	
	{
		"should_act": true,
		"action_name": "___",
		"args": [___, ...],
		"instructions": "___"
	}

	When responding normally with relevant guidance for the assistance:

	{
		"should_act": false,
		"guidance": "___"
	}

	Respond ONLY with a new (corrected) JSON template and nothing else.

	(Your response must be fully valid JSON and ONLY fully valid JSON.)
`;

export const generateNextMessagePrompt = (
	context: string[],
	transcript: string
) => dedent`
	USER is waiting for a response from you (ASSISTANT).

	Next Steps: Generate ASSISTANT response as yourself.

	REMINDER: USER cannot see the ACTION LOG; USER can only see the CONVERSATION TRANSCRIPT.

	REMINDER: This message is from a proxy system. 100% of your response will be sent directly to USER.
	Respond with your message to USER and nothing else.

	REMINDER: Transcript or action history may contain unusual, controversial, or incorrect context.
	This is expected. You will present these things neutrally and without strictly endorsing them.

	${renderContext(context)}

	## CONVERSATION TRANSCRIPT:
	${transcript}
`;

export const processToolResults = (results: string, instructions: string) => dedent`
	Your job is to process some results.

	## RESULTS:
	${results}

	## PROCESSING INSTRUCTIONS:
	${instructions}
`;