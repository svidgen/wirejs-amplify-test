import { randomUUID } from 'crypto';
import {
	Context,
	DistributedTable,
	LLM as LLMService,
	LLMChunk,
	LLMMessage,
	PassThruParser,
	RealtimeService,
	Resource,
	Setting,
	User,
} from "wirejs-resources";
import { fromAsync, pad } from "./utils.js";
import { Chunk, ChunkData, Conversation, ConversationMessage } from "./types.js";

export type AssistOptions = {
	systemPromptOverride?: string;
	history: LLMMessage[];
} | {
	systemPromptOverride?: string;
	prompt: string;
};

export type RespondOptions = {
	conversationId: string;
	history: LLMMessage[];
	systemPromptOverride?: string;
} | {
	conversationId: string;
	mid: number;
	prompt: string;
	systemPromptOverride?: string;
};

export type InfraOptions = {
	systemPrompt?: string;
}

export class Infra extends Resource {
	private conversations: ReturnType<typeof makeConversationsTable>;
	private messages: ReturnType<typeof makeMessagesTable>;
	private realtime: ReturnType<typeof makeRealtimeService>;
	private llm: ReturnType<typeof makeLLMService>;
	private modelSetting: ReturnType<typeof makeModelsOverrideSetting>;

	constructor(scope: string | Resource, id: string, options?: InfraOptions) {
		super(scope, id);
		this.conversations = makeConversationsTable(this);
		this.messages = makeMessagesTable(this);
		this.realtime = makeRealtimeService(this);
		this.llm = makeLLMService(this, options?.systemPrompt);
		this.modelSetting = makeModelsOverrideSetting(this);
	}

	async assist(options: AssistOptions): Promise<LLMMessage> {
		// TODO: debounce and/or redesign model settings relationship
		const overrides = (await this.modelSetting.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) this.llm.models = overrides;

		return this.llm.continueConversation({
			systemPrompt: options.systemPromptOverride,
			history: 'history' in options ? options.history : [{
				role: 'user',
				content: options.prompt
			}]
		});
	}

	async respond(options: RespondOptions): Promise<ConversationMessage> {
		// TODO: debounce and/or redesign model settings relationship
		const overrides = (await this.modelSetting.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) this.llm.models = overrides;

		const mid = 'mid' in options ? options.mid : options.history.length;

		// responses are not stream directly because they're unnecessarily frequent.
		// we slow this down, send messages in batches to reduce unnecessary cost.
		let seq = 0;
		let batch: string[] = [];
		let lastBatch = new Date().getTime();

		const onChunk = options.conversationId ?
			(async (chunk: LLMChunk) => {
				batch.push(chunk.message.content);
				if (new Date().getTime() - lastBatch > 150) {
					const text = batch.join('');
					batch = [];
					await this.realtime.publish(options.conversationId, [{
						mid,
						seq: seq++,
						pad: pad(),
						data: { type: 'text', text }
					}]);
					lastBatch = new Date().getTime();
				}
			}) : undefined
		;

		const result = await this.llm.continueConversation({
			systemPrompt: options.systemPromptOverride,
			history: 'history' in options ? options.history : [{
				role: 'user',
				content: options.prompt
			}],
			onChunk
		});
		
		if (batch.length > 0) {
			const text = batch.join('');
			await this.realtime.publish(options.conversationId, [{
				mid,
				seq: seq++,
				pad: pad(),
				data: { type: 'text', text }
			}]);
		}

		return this.addMessage(options.conversationId, mid, 'assistant', result.content);
	}

	async createConversation(user: User): Promise<Conversation> {
		const createdAt = Date.now();
		const timestamp = new Date().toLocaleString();
		const name = `Conversation ${timestamp}`;
		const userId = user.id;

		for (let i = 0; i < 10; i++) {
			const conversationId = randomUUID();
			const conversation = {
				conversationId, userId, createdAt, name
			} satisfies Conversation;
			await this.conversations.save(conversation, { onlyIfNotExists: true });
			return conversation;
		}

		throw new Error("Could not create a unique conversation ID!");
	}

	async updateConversationName(conversationId: string, name: string): Promise<void> {
		const conversation = await this.getConversation(conversationId);
		if (!conversation) throw new Error("Conversation doesn't exist.");
		conversation.name = name;
		await this.conversations.save(conversation);
		await this.sendControlMessage(conversationId, {
			type: 'title',
			value: name
		});
	}

	async getConversation(conversationId: string): Promise<Conversation | undefined> {
		return this.conversations.get({ conversationId });
	}

	async listUserConversations(user: User): Promise<Conversation[]> {
		const conversationsGen = this.conversations.query({
			by: 'userId-createdAt',
			where: { userId: { eq: user.id } }
		});
		const conversations: Conversation[] = await fromAsync(conversationsGen);
		return conversations.sort((a, b) => b.createdAt - a.createdAt);
	}

	async assertUserIsAuthorized(
		user: User,
		conversation: string | Conversation | undefined
	) : Promise<void> {
		if (typeof conversation === 'string') {
			const record = await this.getConversation(conversation);
			return this.assertUserIsAuthorized(user, record);
		} else if (conversation?.userId !== user.id) {
			throw new Error("Not authorized");
		}
	}

	async deleteConversation(conversationId: string): Promise<void> {
		// start with the header. if needs be, individual messages can be cleaned up
		// later. whereas if we start with the messages and are interrupted, we'd just
		// but corrupting a conversation.
		await this.conversations.delete({ conversationId });

		const messagesGen = this.messages.query({
			by: 'conversationId-mid',
			where: { conversationId: { eq: conversationId } }
		});
		const messagesToDelete = await fromAsync(messagesGen);
		await Promise.all(messagesToDelete.map(msg => this.messages.delete(msg)));
	}

	async getHistory(conversationId: string): Promise<ConversationMessage[]> {
		const storedMessages = this.messages.query({
			by: 'conversationId-mid',
			where: { conversationId: { eq: conversationId } }
		});

		// Convert async generator to array and sort by mid
		const messagesArray = await fromAsync(storedMessages);
		messagesArray.sort((a, b) => a.mid - b.mid);
		return messagesArray;
	};

	async addMessage(
		conversationId: string,
		mid: number,
		role: ConversationMessage['role'],
		content: string,
	): Promise<ConversationMessage> {
		const message: ConversationMessage = {
			conversationId,
			mid,
			role,
			content,
			createdAt: Date.now()
		};

		await this.messages.save(message, { onlyIfNotExists: true });
		return message;
	};

	getStream(context: Context, conversationId: string) {
		return this.realtime.getStream(context, conversationId);
	}

	async sendControlMessage(conversationId: string, data: ChunkData, mid: number = -1): Promise<void> {
		await this.realtime.publish(conversationId, [{
			mid,
			seq: 0,
			pad: pad(),
			data
		}]);
	}
}

const makeRealtimeService = (scope: Resource) => new RealtimeService<Chunk>(scope, 'realtime');

const makeConversationsTable = (scope: Resource) => new DistributedTable(
	scope,
	'conversations',
	{
		parse: PassThruParser<Conversation>,
		key: {
			partition: { field: 'conversationId', type: 'string' },
		},
		indexes: [
			{
				partition: { field: 'userId', type: 'string' },
				sort: { field: 'createdAt', type: 'number' }
			}
		],
	}
);

const makeMessagesTable = (scope: Resource) => new DistributedTable(
	scope,
	'messages',
	{
		parse: PassThruParser<ConversationMessage>,
		key: {
			partition: { field: 'conversationId', type: 'string' },
			sort: { field: 'mid', type: 'number' }
		}
	}
);

const makeLLMService = (scope: Resource, systemPrompt?: string) => new LLMService(scope, 'llm', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt
});

const makeModelsOverrideSetting = (scope: Resource) => new Setting(scope, 'models', {
	private: false,
	init: () => 'llama3.2, llama3:8b, llama2'
});