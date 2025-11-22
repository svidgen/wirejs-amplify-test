import {
	DistributedTable,
	LLM as LLMService,
	LLMMessage,
	PassThruParser,
	RealtimeService,
	Setting,
	Resource
} from "wirejs-resources";
import { fromAsync } from "./utils";
import { Chunk, Conversation, ConversationMessage } from "./types";


export class Infra extends Resource {
	conversations: ReturnType<typeof makeConversationsTable>;
	messages: ReturnType<typeof makeMessagesTable>;
	realtime: ReturnType<typeof makeRealtimeService>;
	llm: ReturnType<typeof makeLLMService>;
	modelSetting: ReturnType<typeof makeModelsOverrideSetting>;

	constructor(scope: Resource, id: string) {
		super(scope, id);
		this.conversations = makeConversationsTable(this);
		this.messages = makeMessagesTable(this);
		this.realtime = makeRealtimeService(this);
		this.llm = makeLLMService(this);
		this.modelSetting = makeModelsOverrideSetting(this);
	}

	async getRawConversationHistory(userIdRoomId: string): Promise<ConversationMessage[]> {
		const storedMessages = this.messages.query({
			by: 'userIdRoomId-mid',
			where: { userIdRoomId: { eq: userIdRoomId } }
		});

		// Convert async generator to array and sort by mid
		const messagesArray = await fromAsync(storedMessages);
		messagesArray.sort((a, b) => a.mid - b.mid);
		return messagesArray;
	};

	async mapRawHistoryToMessages(messages: ConversationMessage[]) {
		const history: LLMMessage[] = [];
		for (const m of messages) {
			if (m.role === 'user' || m.role === 'assistant') {
				history.push({
					role: m.role,
					content: m.content
				});
			}
		}
		return history;
	}

	async storeMessage(
		userIdRoomId: string,
		mid: number,
		role: ConversationMessage['role'],
		content: string,
		toolCall?: any,
		toolResult?: string
	) {
		const message: ConversationMessage = {
			userIdRoomId,
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
			partition: { field: 'userId', type: 'string' },
			sort: { field: 'roomId', type: 'string' }
		}
	}
);

const makeMessagesTable = (scope: Resource) => new DistributedTable(
	scope,
	'messages',
	{
		parse: PassThruParser<ConversationMessage>,
		key: {
			partition: { field: 'userIdRoomId', type: 'string' },
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