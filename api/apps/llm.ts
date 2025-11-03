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
		const toolCalls: { tool: string; args: any[] }[] = [];
		
		// Simple pattern to find tool usage requests (much simpler syntax)
		const toolCallPattern = /TOOL:(\w+)\s+(.+)/g;
		let match;
		
		while ((match = toolCallPattern.exec(message)) !== null) {
			const toolName = match[1];
			const toolArgs = match[2].trim();
			
			if (availableTools.hasOwnProperty(toolName)) {
				toolCalls.push({
					tool: toolName,
					args: [toolArgs] // Pass the raw arguments as a single string
				});
			}
		}

		if (toolCalls.length > 0) {
			const results = await Promise.all(
				toolCalls.map(async (call) => {
					try {
						console.log('Delegating to sub-agent for tool:', call.tool);
						return await executeToolWithSubAgent(call.tool, call.args[0]);
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

// Sub-agent that handles individual tool calls
const executeToolWithSubAgent = async (toolName: string, userRequest: string): Promise<string> => {
	const tool = (availableTools as any)[toolName];
	if (!tool) {
		throw new Error(`Tool ${toolName} not found`);
	}

	const toolSubAgent = new LLMService('app', 'tool-sub-agent', {
		models: ['llama3.2', 'llama3:8b', 'llama2'],
		systemPrompt: `You are a specialized tool execution assistant. Your job is to:

1. Take a user request and execute it using the ${toolName} tool
2. Format the tool arguments correctly 
3. Interpret and clean up the tool results for the user

Available tool: ${toolName}
${tool.description}

Instructions:
- Parse the user's request to understand what they want
- Execute the tool with proper arguments
- Clean up and summarize the results in a human-readable format
- Remove any technical artifacts, JSON formatting, or API errors
- Provide a concise, useful response

You should ONLY execute the specified tool and return clean results. Do not explain the process.`
	});

	// Let the sub-agent process the request and execute the tool
	const result = await toolSubAgent.continueConversation([
		{
			role: 'user',
			content: userRequest
		}
	]);

	// Extract just the tool execution part - sub-agent will handle formatting
	const toolConfig = (availableTools as any)[toolName];
	if (!toolConfig) {
		throw new Error(`Tool ${toolName} not found`);
	}

	// For now, let's have the sub-agent help us format the arguments, then we execute
	// This is a simplified approach - in a full implementation, the sub-agent would handle execution too
	let toolResult: string;
	
	if (toolName === 'httpGet') {
		// Extract URL from the user request or sub-agent guidance
		const urlMatch = userRequest.match(/https?:\/\/[^\s]+/) || 
		                result.content.match(/https?:\/\/[^\s]+/);
		if (urlMatch) {
			const rawResult = await toolConfig.execute(urlMatch[0]);
			// Let sub-agent clean up the result
			const cleanupResult = await toolSubAgent.continueConversation([
				{ role: 'user', content: userRequest },
				{ role: 'assistant', content: result.content },
				{ role: 'user', content: `Raw tool result: ${rawResult}\n\nPlease clean this up and provide a concise, human-readable summary.` }
			]);
			toolResult = cleanupResult.content;
		} else {
			toolResult = "Could not extract URL from request";
		}
	} else {
		toolResult = "Tool not implemented";
	}

	return toolResult;
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

To use a tool, include this simple format in your response:

TOOL:httpGet https://example.com/api/data

The tool assistant will handle the request and return clean, formatted results.

Guidelines:
- Only use tools when you need external data or information
- Use simple, clear requests 
- The tool results will be automatically integrated into your response
- Continue your response normally after the tool request

Example:
To get information about whales, I'll look that up for you.

TOOL:httpGet https://en.wikipedia.org/w/api.php?action=query&titles=Whales&format=json

(The tool results will appear here automatically, then continue your response)
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
		} else if (msg.role === 'tool-result') {
			// Tool results are injected as user messages to the LLM
			llmHistory.push({
				role: 'user',
				content: `<tool-result>\n${msg.content}\n</tool-result>`
			});
		}
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

			// Store the assistant's response (which may contain tool calls)
			await storeMessage(room, assistantMid, 'assistant', result.content);
			
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
				// Send the tool results as additional content to the current message
				await llmRealtimeService.publish(room, [{
					mid: assistantMid,
					seq: seq++,
					pad: pad(),
					data: { text: `\n\n${toolResults}\n\n` }
				}]);

				// Send tool processing indicator to keep UI in thinking state for continuation
				await llmRealtimeService.publish(room, [{
					mid: assistantMid,
					seq: seq++,
					pad: pad(),
					data: `**tool-processing**`
				}]);

				// Store tool call and result as separate messages
				currentMid++;
				await storeMessage(room, currentMid, 'tool-result', toolResults);
				
				// Add properly formatted tool results to conversation history for the next LLM call
				history.push({
					role: 'user',
					content: `Tool results:\n\n${toolResults}\n\nPlease continue your response, incorporating this information naturally.`
				} satisfies LLMMessage);
			}
		} while (toolResults);

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