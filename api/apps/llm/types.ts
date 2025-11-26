import { LLMMessage } from "wirejs-resources";

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

export type ConversationMessage = {
	conversationId: string;
	mid: number;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
};

export type ToolDefinition = {
	description: string;
	arguments: string;
	execute: (...args: any) => Promise<any>
};

export type ToolDefinitions = Record<string, ToolDefinition>;

export type Message = LLMMessage;
