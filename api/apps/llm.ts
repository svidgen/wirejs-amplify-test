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
	data: '**start**' | '**end**' | MinimalChunk;
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
		
		// Simple regex to find JSON code blocks with tool calls
		const toolCallPattern = /```\s*(\{.+\})\s*```/gs;
		let match;
		
		while ((match = toolCallPattern.exec(message)) !== null) {
			try {
				const call = JSON.parse(match[1]);
				if (call && call.tool) {
					toolCalls.push(call);
				}
			} catch (error) {
				console.error(`Failed to parse tool call: ${match[1]}`, error);
			}
		}

		if (toolCalls.length > 0) {
			const results = await Promise.all(
				toolCalls.map(async (call) => {
					try {
						console.log('calling tool', call);
						return await (availableTools as any)[call.tool](
							...(Array.isArray(call.args) ? call.args : [])
						);
					} catch (error) {
						return `<tool-error tool="${call.tool}">${error}</tool-error>`;
					}
				})
			);
			return results.join('\n\n');
		}
	} catch (error) {
		return `<tool-error>${error}</tool-error>`;
	}
	return undefined;
};

const availableTools = {
	async httpGet(url: string) {
		console.log(`fetching ${url}`);
		const request = await fetch(url);
		const body = await request.text();
		// console.log('result', body);
		return body;
	}
};

const availableToolsPrompt = `
# Tool Calling

These tool functions are available to you if needed:

\`\`\`
{
${Object.entries(availableTools)
	.map(([name, fn]) => `${name}: ${fn.toString()}`)
	.join('\n')
}
}
\`\`\`

**IMPORTANT: Only use tools when external data or actions is required.**

If you do need to call a tool, use this format:

\`\`\`
{
	"tool": "NAME_OF_TOOL",
	"args": [ARG1, ARG2, ...]
}
\`\`\`

Rules:
1. The tool call MUST be valid JSON in a code block.
2. Arguments must be an array.
3. Use double quotes for all JSON strings.
4. **DO NOT** use tools unless my request is best fulfilled with tool use.
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

			// Store the assistant's response
			await storeMessage(room, assistantMid, 'assistant', result.content);
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

			toolResults = await callTools(result.content);

			if (toolResults) {
				// Store tool call and result as separate messages
				currentMid++;
				await storeMessage(room, currentMid, 'tool-result', toolResults);
				
				history.push({
					role: 'user',
					content: `<tool-result>\n${toolResults}\n</tool-result>`
				} satisfies LLMMessage);
				
				// Prepare for next assistant response
				currentMid++;
				assistantMid = currentMid;
			}

			console.log('result', result);
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