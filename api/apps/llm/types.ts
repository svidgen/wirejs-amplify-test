import { LLMMessage } from "wirejs-resources";

export type Chunk = {
	mid: number;
	seq: number;
	pad: string; // security padding
	data: MinimalChunk | ControlMessage;
}

export type ControlMessage =
	| { instruction: 'start' }
	| { instruction: 'end' }
	| { instruction: 'setConversationField', field: 'title', value: string }
	| { instruction: 'setStatus', status: string }
;

export type Conversation = {
	userId: string;
	conversationId: string;
	name: string;
	createdAt: number;
};

export type ConversationMessage = {
	conversationId: string;
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

export type ToolDefinition = {
	description: string;
	execute: (...args: any) => Promise<any>
};

export type ToolDefinitions = Record<string, ToolDefinition>;

export type Message = LLMMessage;

export type MinimalChunk = {
	text: string;
};