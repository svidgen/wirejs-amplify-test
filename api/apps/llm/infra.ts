import { randomUUID } from 'crypto';
import {
	DistributedTable,
	LLM as LLMService,
	LLMMessage,
	PassThruParser,
	RealtimeService,
	Setting,
	Resource
} from "wirejs-resources";
import { fromAsync } from "./utils.js";
import { Chunk, Conversation, ConversationMessage } from "./types.js";

export type InvokeLLMOptions = {
	systemPrompt: string;
	history: LLMMessage[]
};

export class Infra extends Resource {
	private conversations: ReturnType<typeof makeConversationsTable>;
	private messages: ReturnType<typeof makeMessagesTable>;
	private realtime: ReturnType<typeof makeRealtimeService>;
	private llm: ReturnType<typeof makeLLMService>;
	private modelSetting: ReturnType<typeof makeModelsOverrideSetting>;

	constructor(scope: string | Resource, id: string) {
		super(scope, id);
		this.conversations = makeConversationsTable(this);
		this.messages = makeMessagesTable(this);
		this.realtime = makeRealtimeService(this);
		this.llm = makeLLMService(this);
		this.modelSetting = makeModelsOverrideSetting(this);
	}

	async invokeLLM() {
		// TODO: debounce this activity
		const overrides = (await this.modelSetting.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) this.llm.models = overrides;

		// TODO ...
	}

	async createConversation(userId: string): Promise<Conversation> {
		const createdAt = Date.now();
		const timestamp = new Date().toLocaleString();
		const name = `Conversation ${timestamp}`

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
	}

	async getConversation(conversationId: string): Promise<Conversation | undefined> {
		return this.conversations.get({ conversationId });
	}

	async getRawConversationHistory(conversationId: string): Promise<ConversationMessage[]> {
		const storedMessages = this.messages.query({
			by: 'conversationId-mid',
			where: { conversationId: { eq: conversationId } }
		});

		// Convert async generator to array and sort by mid
		const messagesArray = await fromAsync(storedMessages);
		messagesArray.sort((a, b) => a.mid - b.mid);
		return messagesArray;
	};

	async storeMessage(
		conversationId: string,
		mid: number,
		role: ConversationMessage['role'],
		content: string,
		toolCall?: any,
		toolResult?: string
	) {
		const message: ConversationMessage = {
			conversationId,
			mid,
			role,
			content,
			toolCall,
			toolResult,
			createdAt: Date.now()
		};

		await this.messages.save(message);
		return message;
	};
}

const makeRealtimeService = (scope: Resource) => new RealtimeService<Chunk>(scope, 'realtime');

const makeConversationsTable = (scope: Resource) => new DistributedTable(
	scope,
	'conversations',
	{
		parse: PassThruParser<Conversation>,
		key: {
			partition: { field: 'conversationId', type: 'string' },
		}
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

const makeLLMService = (scope: Resource) => new LLMService(scope, 'llm', {
	models: ['llama3.2', 'llama3:8b', 'llama2']
});

const makeModelsOverrideSetting = (scope: Resource) => new Setting(scope, 'models', {
	private: false,
	init: () => 'llama3.2, llama3:8b, llama2'
});