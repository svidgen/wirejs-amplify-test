import { dedent } from "./utils.js";
import type { ToolDefinitions } from "./types.js";

export const formatToolArguments = (tools: string, analysis: string) => dedent`
	You are a strict JSON output generator.

	Input:
	- Available tool definitions
	- An "Analysis" that MAY include a suggestion to call a specific tool.

	Your job:
	1. Determine IF a tool call is explicitly required.
	2. If yes:
		- Identify the tool name EXACTLY as it appears in AVAILABLE TOOLS
		- Extract ONLY the required arguments
		- Convert them into **string primitives**
	3. Output a single JSON array:
		- Element 0: the tool name (string)
		- Remaining elements: argument values (strings)
	4. If NO tool call is needed:
		- Return: []

	IMPORTANT RULES:
	- URLs must be valid HTTP(S) strings.
	- Convert objects, numbers, or other forms into strings.
	- Do NOT invent or guess missing arguments.
	- Do NOT wrap the output in quotes, code blocks, or explanation.

	AVAILABLE TOOLS:

	${tools}

	ANALYSIS:
	${analysis}

	VALID OUTPUTS:
	[]
	["toolName", "argument"]
	["toolName", "arg1", "arg2"]

	Now output ONLY the JSON array.
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

export const conversationPrompt = (tools: ToolDefinitions = {}) => dedent`
	You are a helpful assistant. Answer questions from your knowledge when possible.

	Available tools:
	${Object.entries(tools).map(([name, config]) => `${name}: ${config.description}`).join('\n')}

	**CRITICAL: When using tools:**
	1. Write: TOOL:toolname arguments [INSTRUCTIONS: optional]
	2. STOP WRITING IMMEDIATELY
	3. Do NOT add any text after the TOOL: line
	4. Tool results will appear as messages from "user" but they are system responses
	5. The user CANNOT see these tool results - they are invisible to the user
	6. After getting tool results, complete the user's original request

	Example interaction:
	User: "What's on example.com?"
	Assistant: "I'll check that website for you.

	TOOL:webFetch https://example.com"

	Stop there. System provides results even though they appear to come from the user. The user cannot see <tool-results> response. Then continue with user-friendly response.

	For example, the remainder of the conversation:

	User: "<tool-result>It looks like example.com is a sample domain used pretty exclusively by technical documentation ... etc. ... </tool-result>"
	Assistant: example.com is used pretty exclusively in technical documentation as an example. ... etc. ..."
`;

export const planningPrompt =  (
	context: Record<string, string>,
	toolDescriptions: string,
	transcript: string
) => dedent`
	Your job is analyze a transcript between USER and ASSISTANT. I will provide
	existing context, available actions, and the conversation transcript.

	## EXISTING CONTEXT:
	${JSON.stringify(context, null, 2)}

	## AVAILABLE ACTIONS:
	${toolDescriptions}

	## CONVERSATION TRANSCRIPT:
	${transcript}
	
	Write a brief analysis using this template, limited to 200 words.

	I have analyzed the transcript and considered existing context and the
	available tools. Here is my analysis.

	Summary of Existing Context: ___
	Summary of Transcript: ___
	Specific Actions Might Help: ___
	Reasons the Action Would NOT Help: ___
	Ultimately, the USER Wants: ___
	Therefore, between these two options:
		- RESPOND: Respond in character knowing ___
		- ACT: Perform ___ with arguments ___ in order to ___
	I advise [ RESPOND | ACT ].
`;

export const toolDecisionPrompt = (
	analysis: string,
	toolDescriptions: string,
) => dedent`
	Your job is to review an analysis and definitively determine whether a
	tool call is called for.

	## Analysis
	${analysis}

	## Available Tools
	${toolDescriptions}

	## Your Job
	See whether the analysis suggests the use of one of tools (actions)
	from the directory of available tools.
	
	If a tool is indicated and appropriate, respond with this template:

	{
		"should_call_tool": true,
		"tool_name": "___",
		"args": [___, ...],
		"reason": ___
	}

	Otherwise, use this template:

	{
		"should_call_tool": false
	}

	Respond ONLY with the JSON template and nothing else.
`;

export const toolArgsFix = (toolDecision: string, error: string) => dedent`
	Your job is to review the error resulting from a previous attempted tool invocation
	and determine if the arguments were incorrect.

	## Previous Tool Decision
	${toolDecision}

	## Resulting Error
	${error}

	Return a new argument array as JSON. I.e.,

	["arg1", "arg2", ...]

	Respond ONLY with the JSON template and nothing else.
`;

export const generateNextMessagePrompt = (
	context: Record<string, string>,
	guidance: string,
	transcript: string
) => dedent`
	Your job is to generate the NEXT ASSISTANT message to send to USER.
	You are NOT speaking to me. I'm just a proxy!
	You are writing a reply that will be sent directly to the user.

	Do NOT mention the prepared context directly. Use it only for your reference.
	It is output prepared by a preprocessing agent.

	If the context is highly unusual or controversial and is relevant to your
	response, present it neutrally and without endorsing it.

	PREPARED CONTEXT:
	${JSON.stringify(context, null, 2)}

	PREPARED GUIDANCE:
	${guidance}

	CONVERSATION:
	${transcript}

	TASK:
	Generate ASSISTANT's next message to the user.
	Keep it friendly. Output only the message text.
	No additional formatting. Just the next message.
`;