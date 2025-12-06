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
	I am going to provide you with a conversation transcript, some existing context, and
	some actions the ASSISTANT in the conversation could take.

	## EXISTING CONTEXT:
	${JSON.stringify(context, null, 2)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}

	---
	
	You just need to tell me whether the next message from ASSISTANT suggests the need to:
	
	1. Think longer for a better response
	2. Perform one of the Available Actions

	When making your decision, please decide how you would proceed. For example, if USER
	is directly asking for something that requires one of the Available Actions, it would
	be best to perform an action and respond YES.

	Now, please respond with a single word YES or NO.

	Response YES and *only* YES if you would think longer or perform an action.

	Respond NO and *only* NO if you would just respond immediately.
`;

export const planningPrompt = (
	context: Record<string, string>,
	toolDescriptions: string,
	transcript: string
) => dedent`
	I am going to provide you with a conversation transcript, some existing context, and
	some actions the ASSISTANT in the conversation could take.

	## EXISTING CONTEXT:
	${JSON.stringify(context, null, 2)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}

	---
	
	I need you to immediately respond with very brief analysis using the following template
	based on what you would do:

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
	Review the following analysis and definitively determine whether the
	analysis suggests the need to ACT using one of the available tools.

	## Analysis
	${analysis}

	## Available Tools
	${toolDescriptions}

	## Your Job
	Respond using the correct template.
	
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

	(Your response must be valid JSON and ONLY valid JSON.)
`;

export const toolArgsFix = (toolDecision: string, error: string) => dedent`
	Your job is to review the error resulting from a previously attempted 
	response that couldn't be handled correctly.

	## Previously Attempted Response
	${toolDecision}

	## Resulting Error
	${error}

	## Your Job
	Using the Resulting Error to guide you, correct the mistakes from the
	Previously Attempted Response.

	A correct response will be valid JSON using one of these two templates:

	{
		"should_call_tool": true,
		"tool_name": "___",
		"args": [___, ...],
		"reason": "___"
	}

	Or:

	{
		"should_call_tool": false,
		"guidance": "___"
	}

	Respond ONLY with a new (corrected) JSON template and nothing else.

	(Your response must be valid JSON and ONLY valid JSON.)
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