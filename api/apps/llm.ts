import {
	AuthenticationApi,
	BackgroundJob,
	DistributedTable,
	LLM as LLMService,
	LLMMessage,
	PassThruParser,
	RealtimeService,
	Setting,
	User,
	withContext
} from "wirejs-resources";
import { randomUUID } from 'crypto';

export type Chunk = {
	mid: number;
	seq: number;
	pad: string; // security padding
	data: '**start**' | '**end**' | '**tool-processing**' | MinimalChunk;
}

export type Conversation = {
	userId: string;
	roomId: string;
	name: string;
	createdAt: number;
};

export type ConversationMessage = {
	userIdRoomId: string;
	mid: number;
	role: 'user' | 'assistant' | 'tool-call' | 'tool-result';
	content: string; // original text content
	toolCall?: {
		tool: string;
		args: any[];
		instruction?: string;
	};
	toolResult?: string;
	createdAt: number;
	chunks?: Chunk[]; // for streaming assistant messages
};

export type Message = LLMMessage;

export type MinimalChunk = {
	text: string;
};

const modelsOverride = new Setting('app', 'models', {
	private: false,
	init: () => 'llama3.2, llama3:8b, llama2'
});

const llm = new LLMService('app', 'llm', { 
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: 'You are a helpful (but generally concise) assistant.'
});

// Sub-agent for formatting tool arguments from user requests
const toolArgumentFormatter = new LLMService('app', 'tool-argument-formatter', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a tool argument formatter. Your only job is to:
1. Examine the user's request 
2. Extract the exact arguments needed for the specified tool
3. Return ONLY a JSON array of arguments, nothing else

Examples:
- User: "get the content from https://example.com" for httpGet tool -> ["https://example.com"]
- User: "fetch data from api.weather.com/current" for httpGet tool -> ["https://api.weather.com/current"]

Return only the JSON array, no explanations or additional text.`
});

// Sub-agent for processing tool results according to instructions
const toolResultProcessor = new LLMService('app', 'tool-result-processor', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a tool result processor. Your job is to:
1. Take raw tool output
2. Process it according to the specific instructions given by the user
3. Return clean, human-readable results, per the user instructions

Follow specific user instructions exactly.`
});

const llmRealtimeService = new RealtimeService<Chunk>('app', 'llm');

const conversations = new DistributedTable('app', 'llm-conversations', {
	parse: PassThruParser<Conversation>,
	key: {
		partition: { field: 'userId', type: 'string' },
		sort: { field: 'roomId', type: 'string' }
	}
});

const messages = new DistributedTable('app', 'llm-messages', {
	parse: PassThruParser<ConversationMessage>,
	key: {
		partition: { field: 'userIdRoomId', type: 'string' },
		sort: { field: 'mid', type: 'number' }
	}
});

const pad = () => randomUUID().slice(0, 1 + Math.floor(Math.random() * 16));

const callTools = async (message: string): Promise<string | undefined> => {
	try {
		const toolCalls: { tool: string; args: any[]; instruction?: string }[] = [];
		
		// Enhanced pattern to find tool usage requests with optional instructions
		// Format: TOOL:toolName url_or_args [INSTRUCTION: special instructions]
		const toolCallPattern = /TOOL:(\w+)\s+([^\[]+?)(?:\s*\[INSTRUCTION:\s*([^\]]+)\])?/g;
		let match;
		
		while ((match = toolCallPattern.exec(message)) !== null) {
			const toolName = match[1];
			const toolArgs = match[2].trim();
			const instruction = match[3] ? match[3].trim() : undefined;
			
			if (availableTools.hasOwnProperty(toolName)) {
				toolCalls.push({
					tool: toolName,
					args: [toolArgs],
					instruction
				});
			}
		}

		if (toolCalls.length > 0) {
			const results = await Promise.all(
				toolCalls.map(async (call) => {
					try {
						console.log('Delegating to sub-agent for tool:', call.tool, 'with instruction:', call.instruction);
						console.log('Tool call args:', call.args);
						// Pass the original message context, not just the extracted args
						return await executeToolWithSubAgent(call.tool, message, call.instruction);
					} catch (error) {
						return `Tool error: ${error}`;
					}
				})
			);
			return results.join('\n\n');
		}
	} catch (error) {
		return `Tool error: ${error}`;
	}
	return undefined;
};

// Three-step tool execution with specialized sub-agents
const executeToolWithSubAgent = async (toolName: string, userRequest: string, instruction?: string): Promise<string> => {
	const tool = (availableTools as any)[toolName];
	if (!tool) {
		throw new Error(`Tool ${toolName} not found`);
	}

	try {
		console.log(`executeToolWithSubAgent - toolName: ${toolName}, userRequest: "${userRequest}"`);
		
		// Step 1: Format tool arguments using dedicated sub-agent
		const argsPrompt = `Tool: ${toolName}
Tool Description: ${tool.description}
User Request: ${userRequest}

Extract the arguments needed for this tool and return as a JSON array.`;
		
		console.log('Sending to argument formatter:', argsPrompt);
		
		const argsResult = await toolArgumentFormatter.continueConversation([
			{ role: 'user', content: argsPrompt }
		]);
		
		console.log('Argument formatter response:', argsResult.content);
		
		// Parse arguments from formatter sub-agent
		const args = JSON.parse(argsResult.content.trim());
		console.log('Parsed args:', args);
		
		// Step 2: Execute the tool with formatted arguments
		const rawResult = await tool.execute(...args);
		
		// Step 3: Process results using dedicated sub-agent
		let processingInstruction = `Clean up and summarize the results in a human-readable format. Remove any technical artifacts, JSON formatting, or API errors. Provide a concise, useful response.`;
		
		if (instruction) {
			processingInstruction = instruction;
		}
		
		const resultPrompt = `Processing Instruction: ${processingInstruction}

Raw Tool Result:
${rawResult}

Please process this result according to the instruction above.`;
		
		const processedResult = await toolResultProcessor.continueConversation([
			{ role: 'user', content: resultPrompt }
		]);
		
		return processedResult.content;
		
	} catch (error) {
		return `Tool execution failed: ${error}`;
	}
};

const availableTools = {
	httpGet: {
		description: 'Fetches content from a URL. Format URLs properly and return clean, readable results.',
		async execute(url: string) {
			console.log(`fetching ${url}`);
			const request = await fetch(url);
			const body = await request.text();
			return body;
		}
	}
};

const availableToolsPrompt = `
# Tool Usage

When you need to use external tools for research or data gathering, you can send requests to a specialized assistant.

Available tools:
${Object.entries(availableTools).map(([name, config]) => `- ${name}: ${config.description}`).join('\n')}

To use a tool, include this format in your response:

TOOL:httpGet https://example.com/api/data

For special processing instructions, use the optional INSTRUCTION parameter:

TOOL:httpGet https://example.com/weather [INSTRUCTION: extract only the temperature and conditions]

The tool assistant will handle the request and return results processed according to your instructions.

Guidelines:
- Only use tools when you need external data or information
- Use simple, clear requests 
- Add specific instructions if you need particular formatting or processing
- The tool results will be automatically integrated into your response
- Continue your response normally after the tool request

(The processed tool results will appear here automatically, then continue your response)
`;

/**
 * Helper function to convert async generator to array (for Node 20 compatibility)
 */
async function fromAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of gen) {
		items.push(item);
	}
	return items;
}

const getConversationHistory = async (userIdRoomId: string): Promise<LLMMessage[]> => {
	const storedMessages = messages.query({
		by: 'userIdRoomId-mid',
		where: { userIdRoomId: { eq: userIdRoomId } }
	});

	const llmHistory: LLMMessage[] = [];
	
	// Convert async generator to array and sort by mid
	const messagesArray = await fromAsync(storedMessages);
	messagesArray.sort((a, b) => a.mid - b.mid);
	
	for (const msg of messagesArray) {
		if (msg.role === 'user' || msg.role === 'assistant') {
			llmHistory.push({
				role: msg.role,
				content: msg.content
			});
		}
		// Note: tool-result messages are no longer stored separately
		// Tool results are now included in assistant messages
	}
	
	return llmHistory;
};

const storeMessage = async (userIdRoomId: string, mid: number, role: ConversationMessage['role'], content: string, toolCall?: any, toolResult?: string) => {
	const message: ConversationMessage = {
		userIdRoomId,
		mid,
		role,
		content,
		toolCall,
		toolResult,
		createdAt: Date.now()
	};
	
	await messages.save(message);
	return message;
};

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, newUserMessage: string) => {
		const overrides = (await modelsOverride.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) llm.models = overrides;
		
		// Load conversation history from database
		const history = await getConversationHistory(room);
		
		// Get the next message ID by finding the highest existing mid
		const existingMessagesGen = messages.query({
			by: 'userIdRoomId-mid',
			where: { userIdRoomId: { eq: room } }
		});
		const existingMessages = await fromAsync(existingMessagesGen);
		const nextMid = existingMessages.length > 0 ? 
			Math.max(...existingMessages.map(m => m.mid)) + 1 : 0;
		
		// Store the new user message
		await storeMessage(room, nextMid, 'user', newUserMessage);
		history.push({ role: 'user', content: newUserMessage });
		
		let currentMid = nextMid + 1;
		let assistantMid = currentMid; // Track the actual assistant message ID
		let seq = 0;
		let batch: string[] = [];
		let lastBatch = new Date().getTime();
		let toolResults: string | undefined = undefined;

		await llmRealtimeService.publish(room, [{
			mid: assistantMid,
			seq: seq++,
			pad: pad(),
			data: `**start**`
		}]);

		let assistantMessageContent = '';
		
		do {
			console.log('=== LLM Iteration Start ===');
			console.log('History length:', history.length);
			console.log('Last 3 history items:', history.slice(-3));
			
			const result = await llm.continueConversation(
				[
					{
						role: 'user',
						content: availableToolsPrompt
					},
					...history
				],
				async chunk => {
					batch.push(chunk.message.content);
					if (new Date().getTime() - lastBatch > 150) {
						const text = batch.join('');
						batch = [];
						await llmRealtimeService.publish(room, [{
							mid: assistantMid,
							seq: seq++,
							pad: pad(),
							data: { text }
						}]);
						lastBatch = new Date().getTime();
					}
				}
			);
		
			console.log('LLM result:', result.content);
			console.log('=== LLM Iteration End ===');

			// Build up the complete assistant message content
			assistantMessageContent += result.content;
			
			// Add assistant response to working history
			history.push(result);

			if (batch.length > 0) {
				const text = batch.join('');
				await llmRealtimeService.publish(room, [{
					mid: assistantMid,
					seq: seq++,
					pad: pad(),
					data: { text }
				}]);
				batch = [];
			}

			// Check for and execute any tool calls in the response
			toolResults = await callTools(result.content);

			if (toolResults) {
				// Add tool results to the complete assistant message
				assistantMessageContent += `\n\n<tool-result>\n${toolResults}\n</tool-result>\n\n`;
				
				// Send the tool results as additional content to the current message, wrapped in tags
				await llmRealtimeService.publish(room, [{
					mid: assistantMid,
					seq: seq++,
					pad: pad(),
					data: { text: `\n\n<tool-result>\n${toolResults}\n</tool-result>\n\n` }
				}]);

				// Send tool processing indicator to keep UI in thinking state for continuation
				await llmRealtimeService.publish(room, [{
					mid: assistantMid,
					seq: seq++,
					pad: pad(),
					data: `**tool-processing**`
				}]);
				
				// Add tool results to conversation history in the same format as stored messages
				// This ensures consistency between live conversation and retrieved history
				history.push({
					role: 'user',
					content: `<tool-result>\n${toolResults}\n</tool-result>`
				} satisfies LLMMessage);
			}
		} while (toolResults);
		
		// Store the complete assistant message including any tool results
		await storeMessage(room, assistantMid, 'assistant', assistantMessageContent);

		await llmRealtimeService.publish(room, [{
			mid: assistantMid,
			seq,
			pad: pad(),
			data: `**end**`
		}]);
	}
});


const assertIsAuthorized = (user: User, room: string) => {
	if (!room.startsWith(`${user.id}/`)) {
		throw new Error("Not authorized");
	}
}

export const LLM = (auth: AuthenticationApi) => withContext(context => ({
	async send(room: string, message: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		if (!room || !message || !message.trim()) {
			throw new Error('Room and message are required');
		}
		await chatRunner.start(room, message.trim());
	},
	async getRoom(room: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		return llmRealtimeService.getStream(context, room);
	},
	async getHistory(room: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		const messagesGen = messages.query({
			by: 'userIdRoomId-mid',
			where: { userIdRoomId: { eq: room } }
		});
		const messagesArray = await fromAsync(messagesGen);
		return messagesArray
			.sort((a, b) => a.mid - b.mid)
			.filter(m => m.role === 'user' || m.role === 'assistant')
			.map(m => ({
				role: m.role,
				content: m.content,
				createdAt: m.createdAt
			}));
	},
	async createRoom() {
		const user = await auth.requireCurrentUser(context);
		const id = crypto.randomUUID();
		return `${user.id}/${id}`;
	}
}));