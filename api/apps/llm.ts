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
};

export type ConversationMessage = {
	userIdRoomId: string;
	mid: number;
	role: 'user' | 'assistant';
	chunks: Chunk[];
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
		const toolCall = message.match(/<tool\-call>(.+)<\/tool\-call>/s);
		if (toolCall) {
			const call = JSON.parse(toolCall[1].trim());
			console.log('calling tool', call);
			if (call && call.tool) {
				const result = await (availableTools as any)[call.tool](
					...(Array.isArray(call.args) ? call.args : [])
				);
				return result;
			}
		}
	} catch (error) {
		return `<tool-error>${error}</tool-error>`
	}
	return undefined;
}

const availableTools = {
	async httpGet(url: string) {
		console.log(`fetching ${url}`);
		const request = await fetch(url);
		const body = await request.text();
		console.log('result', body);
		return body;
	}
};

const availableToolsPrompt = `
# Tool Calling

You may call any of these functions as part of your response to me if needed.

\`\`\`
{
${Object.entries(availableTools)
	.map(([name, fn]) => `${name}: ${fn.toString()}`)
	.join('\n')
}
}
\`\`\`

To call a tool, include a tag in your response like this:

<tool-call>
{
	tool: "NAME_OF_TOOL",
	args: <ARRAY OF ARGS>
}
</tool-call>

The tool call MUST be a JSON definition of the call stating the name of the tool and argument array
inside the body of a \`<tool-call>\` tag.

Only one tool call per response can be processed.

Only use tools when interaction with these outside systems is required. Otherwise, just respond normally.
`;

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, history: LLMMessage[]) => {
		const overrides = (await modelsOverride.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) llm.models = overrides;
		
		const mid = history.length;
		let seq = 0;
		let batch: string[] = [];
		let lastBatch = new Date().getTime();
		let toolResults: string | undefined = undefined;

		await llmRealtimeService.publish(room, [{
			mid,
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
							mid,
							seq: seq++,
							pad: pad(),
							data: { text }
						}]);
						lastBatch = new Date().getTime();
					}
				}
			);

			history.push(result);

			if (batch.length > 0) {
				const text = batch.join('');
				await llmRealtimeService.publish(room, [{
					mid,
					seq: seq++,
					pad: pad(),
					data: { text }
				}]);
				batch = [];
			}

			toolResults = await callTools(result.content);

			if (toolResults) {
				history.push({
					role: 'user',
					content: `<tool-result>\n${toolResults}\n</tool-result>`
				} satisfies LLMMessage);
			}

			console.log('result', result);
		} while (toolResults);

		console.log('full chat history', history);

		await llmRealtimeService.publish(room, [{
			mid,
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
	async send(room: string, history: LLMMessage[]) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		if (!room || !history || !history.length) {
			throw new Error('Room and history are required');
		}
		await chatRunner.start(room, history);
	},
	async getRoom(room: string) {
		const user = await auth.requireCurrentUser(context);
		assertIsAuthorized(user, room);
		return llmRealtimeService.getStream(context, room);
	},
	async createRoom() {
		const user = await auth.requireCurrentUser(context);
		const id = crypto.randomUUID();
		return `${user.id}/${id}`;
	}
}));