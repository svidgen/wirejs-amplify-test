import { dedent } from "./utils.js";
import type { ToolDefinitions } from "./types.js";

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
	context: Record<string, string>,
	toolDescriptions: string,
	transcript: string
) => dedent`
	## EXISTING CONTEXT:
	${JSON.stringify(context, null, 2)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}

	---

	- Does USER's last message suggest they want or need you to perform one of the actions?
	- Is your own knowledge insufficient or potentially out of date enough to warrant performing an action?
	- Is the topic complex enough to warrant some "thinking aloud" first?

	If any of those are a "yes", respond YES and *only* YES.

	Otherwise, respond NO and *only* NO.

	Now, please respond with a single word YES or NO.
`;

export const planningPrompt = (
	context: Record<string, string>,
	toolDescriptions: string,
	transcript: string
) => dedent`
	## EXISTING CONTEXT:
	${JSON.stringify(context, null, 2)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}

	## REQUIRES THINKING AND/OR ACTION:
	YES

	---

	As you can see, a subordinate agent already decided that responding to USER warrants
	some additional "thinking aloud" and/or the usage of one of the listed actions.
	
	To ensure the best response to USER, please respond use this template:

	The USER wants and/or needs: ___
	The two valid options for ASSISTANT are to:
		- RESPOND: Respond in character knowing ___
		- ACT: Perform ___ with arguments ___ in order to ___
	To satisfy USER, ASSISTANT should [ RESPOND | ACT ].
`;

export const toolDecisionPrompt = (
	analysis: string,
	toolDescriptions: string,
) => dedent`
	## Analysis
	${analysis}

	## Available Tools
	${toolDescriptions}

	## Your Job
	Match the conclusions of the analysis with one of the Available Tools.
	Then, respond using the correct template and ONLY with the correct template.
	
	If a tool is indicated and appropriate, respond with this template:

	{
		"should_call_tool": true,
		"tool_name": "___",
		"args": [___, ...],
		"reason": "___"
	}

	Otherwise, respond with this template:

	{
		"should_call_tool": false,
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

	When performing an action (calling a tool):
	
	{
		"should_call_tool": true,
		"tool_name": "___",
		"args": [___, ...],
		"reason": "___"
	}

	When responding normally with response guidance:

	{
		"should_call_tool": false,
		"guidance": "___"
	}

	Respond ONLY with a new (corrected) JSON template and nothing else.

	(Your response must be fully valid JSON and ONLY fully valid JSON.)
`;

export const generateNextMessagePrompt = (
	context: Record<string, string>,
	guidance: string,
	transcript: string
) => dedent`
	Your job is to write the NEXT ASSISTANT message to send to USER.
	You are NOT speaking to me. You are responding via me to USER. I'm just a proxy!
	You are writing a reply that will be sent directly to the user.

	Do NOT mention the prepared context directly. Use it only for your reference.
	It is output prepared by a preprocessing agent.

	If the context is highly unusual or controversial and is relevant to your
	response, just present it neutrally and without endorsing it.

	PREPARED CONTEXT:
	${JSON.stringify(context, null, 2)}

	PREPARED GUIDANCE:
	${guidance}

	CONVERSATION:
	${transcript}

	---

	TASK:
	Write the next message you would write to the user as ASSISTANT.
	Respond as you normally would. Output only the message text.
	No additional formatting. Just the next message.
`;

export const processToolResults = (results: string, instructions: string) => dedent`
	I need you to act as a tool result processor. Your job is to:

	1. Take raw tool output
	2. Process it according to the specific instructions given by the user
	3. Return clean, human-readable results, per the user instructions

	Follow specific user instructions exactly.

	RESULTS:
	${results}

	INSTRUCTIONS:
	${instructions}

	YOUR TASK:
	Parse, format, or directly pass through the results as necessary to satisfy the
	instruction given above.
`;