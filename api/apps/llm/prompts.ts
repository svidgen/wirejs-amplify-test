import { dedent } from "./utils.js";
import type { ToolDefinitions } from "./types.js";

export const formatToolArguments = (tools: string, instructions: string) => dedent`
	I need you to act as a tool argument formatter. Your only job is to:

	1. Examine the specific instructions
	2. Extract the exact arguments needed for the specified tool
	3. Return ONLY a JSON array of arguments, nothing else
	4. First argument is the name of the tool

	Examples:
	- "get the content from https://example.com using the httpGet tool" -> ["httpGet", "https://example.com"]
	- "fetch data from api.weather.com/current for calculate tool" -> ["calculate", "https://api.weather.com/current"]

	AVAILABLE TOOLS:
	${tools}

	INSTRUCTION:
	${instructions}

	YOUR TASK:
	Return ONLY the raw JSON array. Do NOT wrap it in markdown code blocks or backticks. Do NOT add any explanations.
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