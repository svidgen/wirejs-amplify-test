import { LLMMessage, ToolCall, ToolDefinition as BaseToolDefinition } from "wirejs-resources";

export type Chunk = {
	mid: number;
	seq: number;
	pad: string; // security padding
	data: ChunkData;
}

export type ChunkData =
	| { type: 'start' }
	| { type: 'end' }
	| { type: 'title', value: string }
	| { type: 'status', status: string }
	| { type: 'text', text: string }
;

export type Conversation = {
	userId: string;
	conversationId: string;
	name: string;
	createdAt: number;
	context?: string;
};

export type ConversationMessage = LLMMessage & {
	conversationId: string;
	mid: number;
	createdAt: number;
};

export type ToolDefinition = BaseToolDefinition & {
	execute: (...args: any) => Promise<any>
};

export type Message = LLMMessage;
