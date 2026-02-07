import { LLMMessage, ToolDefinition as BaseToolDefinition } from "wirejs-resources";

export type Role = 'assistant' | 'user' | 'step' | 'tool';

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
	| { type: 'text', text: string, role: Role }
;

export type Conversation = {
	userId: string;
	conversationId: string;
	name: string;
	createdAt: number;
};

export type WorkflowStep = {
	role: 'step';
	content: string;
}

export type ConversationMessage = (WorkflowStep | LLMMessage) & {
	conversationId: string;
	mid: number;
	createdAt: number;
};

export type ToolDefinition = BaseToolDefinition & {
	execute: (...args: any) => Promise<any>
};

export type Message = LLMMessage;
