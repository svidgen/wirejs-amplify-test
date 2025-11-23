import {
	AuthenticationApi,
	BackgroundJob,
	LLM as LLMService,
	LLMMessage,
	User,
	withContext
} from "wirejs-resources";
import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { dedent, extractContentFromHtml, fromAsync } from "./utils.js";
import { agenticHandler } from "./agentic-handler.js";
import { Infra } from "./infra.js";

// Debug logging flag
const DEBUG_AGENT_INTERACTIONS = true;


const pad = () => randomUUID().slice(0, 1 + Math.floor(Math.random() * 16));

// Debug logging helper
const debugLog = (category: string, data: any) => {
	if (DEBUG_AGENT_INTERACTIONS) {
		const timestamp = new Date().toISOString();
		const logEntry = `[${timestamp}] [${category}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n\n`;
		console.log(`[DEBUG-${category}]`, data);
		try {
			const logPath = join(process.cwd(), 'temp', 'agent-debug.log');
			appendFileSync(logPath, logEntry);
		} catch (error) {
			console.warn('Failed to write debug log:', error);
		}
	}
};

const callTools = async (message: string): Promise<string | undefined> => {
	try {
		const toolCalls: { tool: string; args: any[]; instruction?: string }[] = [];

		debugLog('TOOL-CALL-INPUT', `Processing message: "${message}"`);

		// Skip processing if message contains tool results (already processed or hallucinated)
		if (message.includes('<tool-result>')) {
			debugLog('TOOL-CALL-SKIP', 'Skipping message with existing tool results - this may be LLM hallucination');
			return undefined;
		}

		// Look for tool calls that have content after them (potential hallucination)
		// Only detect tool calls at start of line (with optional leading whitespace)
		const toolCallWithHallucinationPattern = /(?:^|\n)\s*TOOL:\w+[^\n]*\n[\s\S]*<tool-result>/;
		if (toolCallWithHallucinationPattern.test(message)) {
			console.log(`[callTools] Detected potential LLM hallucination - tool call with fake results`);
			return undefined;
		}

		// Enhanced pattern to find tool usage requests with optional instructions
		// Format: TOOL:toolName url_or_args [INSTRUCTION: special instructions]
		// IMPORTANT: TOOL: must appear at start of line (with optional leading whitespace)
		const toolCallPattern = /(?:^|\n)\s*TOOL:(\w+)\s+([^\r\n]+?)(?:\s*\[INSTRUCTION:\s*([^\]]+)\])?(?=\s*(?:\r?\n|$))/g;
		let match;

		while ((match = toolCallPattern.exec(message)) !== null) {
			const toolName = match[1];
			const toolArgs = match[2].trim();
			const instruction = match[3] ? match[3].trim() : undefined;

			debugLog('TOOL-CALL-MATCH', { match, toolName, toolArgs, instruction });

			if (availableTools.hasOwnProperty(toolName)) {
				toolCalls.push({
					tool: toolName,
					args: [toolArgs],
					instruction
				});
				debugLog('TOOL-CALL-ADDED', { tool: toolName, args: [toolArgs], instruction });
			} else {
				debugLog('TOOL-CALL-NOT-FOUND', `Tool not found: ${toolName}. Available: ${Object.keys(availableTools).join(', ')}`);
			}
		}

		if (toolCalls.length > 0) {
			const results = await Promise.all(
				toolCalls.map(async (call) => {
					try {
						console.log('Delegating to sub-agent for tool:', call.tool, 'with instruction:', call.instruction);
						console.log('Tool call args:', call.args);
						// Pass the original message context, not just the extracted args
						return await executeToolWithSubAgent(call.tool, message, call.instruction);
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

// Three-step tool execution with specialized sub-agents
const executeToolWithSubAgent = async (
	toolName: string,
	userRequest: string,
	instruction?: string
): Promise<string> => {
	const tool = (availableTools as any)[toolName];
	if (!tool) {
		throw new Error(`Tool ${toolName} not found`);
	}

	try {
		debugLog('TOOL-EXECUTE-START', { toolName, userRequest, instruction });

		// Step 1: Format tool arguments using dedicated sub-agent
		const argsPrompt = `Tool: ${toolName}
Tool Description: ${tool.description}
User Request: ${userRequest}

Extract the arguments needed for this tool and return as a JSON array.`;

		debugLog('ARG-FORMATTER-PROMPT', argsPrompt);

		const argsResult = await toolArgumentFormatter.continueConversation({
			history: [{ role: 'user', content: argsPrompt }],
			timeoutSeconds: 30,
		});

		debugLog('ARG-FORMATTER-RESPONSE', argsResult.content);

		// Clean the response - remove markdown code blocks if present
		let cleanedContent = argsResult.content.trim();
		if (cleanedContent.startsWith('```')) {
			cleanedContent = cleanedContent.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
		}
		console.log('Cleaned content for JSON parsing:', cleanedContent);

		// Parse arguments from formatter sub-agent
		const args = JSON.parse(cleanedContent);
		console.log('Parsed args:', args);

		// Step 2: Execute the tool with formatted arguments
		const rawResult = await tool.execute(...args);
		const stringResult = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
		console.log(`Tool returned ${stringResult.length}`);

		// Step 3: Check if chunking is needed based on content size
		const shouldChunk = stringResult.length > 16_000;
		if (shouldChunk) {
			console.log('Large content detected, using chunked processing');
			const chunkInstruction = instruction || 'Summarize and extract key information from this content.';
			const result = await executeChunkedProcessing(stringResult, chunkInstruction);
			return result;
		}

		// Step 3: Process results using dedicated sub-agent (standard path)
		// Extract text from HTML if needed (same logic as chunked processing)
		let cleanedResult = stringResult;
		if (stringResult.includes('<html') || stringResult.includes('<!DOCTYPE')) {
			cleanedResult = extractContentFromHtml(stringResult);
			console.log(`[Non-chunked] Extracted ${cleanedResult.length} characters of text from HTML`);
		}

		let processingInstruction = `Clean up and condense the results in a concise format for LLM ingestion to fit within 2k words or less if possible. Don't remove information if you don't have to. But, remove any technical artifacts, JSON formatting, or API errors. Provide a concise, useful response. A response between 100 and 2k words is usually the most appropriate, depending on the raw result size. If results already fit within that range roughly, just remove superfluous stuff that would unnecessarily consume LLM tokens.`;

		if (instruction) {
			processingInstruction = instruction;
		}

		const resultPrompt = dedent`
			Processing Instruction: ${processingInstruction}

			Raw Tool Result:
			${cleanedResult}

			Please process this result according to the instruction above.
		`;

		const processedResult = await toolResultProcessor.continueConversation({
			history: [{ role: 'user', content: resultPrompt }],
			timeoutSeconds: 30
		});

		return processedResult.content;

	} catch (error) {
		return `Tool execution failed: ${error}`;
	}
};


const assignConversationName = async (room: string, message: string) => {
	const [userId, roomId] = room.split('/');

	// temporary name first
	const timestamp = new Date().toLocaleString();
	const timestampedTitle = `Conversation ${timestamp}`;
	
	await conversations.save({
		userId,
		roomId,
		name: timestampedTitle,
		createdAt: Date.now()
	});
	
	// Send initial title to client so it appears in dropdown immediately
	await llmRealtimeService.publish(room, [{
		mid: -1, // Special mid for metadata updates
		seq: 0,
		pad: pad(),
		data: `**title-update**:${timestampedTitle}`
	}]);

	// now, try to create a more relevant title
	try {
		const titlePrompt = `Generate a short title for this conversation for this message: ${message}\n\n`;
		const titleResult = await conversationTitleGenerator.continueConversation({
			history: [{ role: 'user', content: titlePrompt }],
			timeoutSeconds: 10
		});
		
		// Clean the title - remove quotes if they wrap the entire title
		let cleanTitle = titleResult.content.trim();
		if ((cleanTitle.startsWith('"') && cleanTitle.endsWith('"')) || 
			(cleanTitle.startsWith("'") && cleanTitle.endsWith("'"))) {
			cleanTitle = cleanTitle.slice(1, -1).trim();
		}
		
		// Store/update conversation record with title
		await conversations.save({
			userId,
			roomId,
			name: cleanTitle,
			createdAt: Date.now()
		});
		
		// Send title update to client via realtime
		await llmRealtimeService.publish(room, [{
			mid: -1, // Special mid for metadata updates
			seq: 0,
			pad: pad(),
			data: `**title-update**:${cleanTitle}`
		}]);
		
		console.log(`Generated conversation title: "${cleanTitle}"`);
	} catch (error) {
		console.error('Failed to generate conversation title:', error);
	}
}


const assertIsAuthorized = (user: User, room: string) => {
	if (!room.startsWith(`${user.id}/`)) {
		throw new Error("Not authorized");
	}
}

export const LLM = (auth: AuthenticationApi) => {
	const infra = new Infra('app', 'llm');
	const chatRunner = new BackgroundJob('app', 'chatRunner', {
		handler: agenticHandler(infra)
	});

	return withContext(context => ({
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
			return infra.realtime.getStream(context, room);
		},
		async getHistory(room: string) {
			const user = await auth.requireCurrentUser(context);
			assertIsAuthorized(user, room);
			const messagesGen = infra.messages.query({
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
		},
		async getConversations() {
			const user = await auth.requireCurrentUser(context);
			const conversationsGen = infra.conversations.query({
				by: 'userId-roomId',
				where: { userId: { eq: user.id } }
			});
			const conversationsArray = await fromAsync(conversationsGen);
			return conversationsArray
				.sort((a, b) => b.createdAt - a.createdAt) // Most recent first
				.map(c => ({
					roomId: `${c.userId}/${c.roomId}`,
					name: c.name || 'Untitled Conversation',
					createdAt: c.createdAt
				}));
		},
		async deleteConversation(room: string) {
			const user = await auth.requireCurrentUser(context);
			assertIsAuthorized(user, room);
			
			// Delete all messages for this conversation
			const messagesGen = infra.messages.query({
				by: 'userIdRoomId-mid',
				where: { userIdRoomId: { eq: room } }
			});
			const messagesToDelete = await fromAsync(messagesGen);
			await Promise.all(messagesToDelete.map(msg => infra.messages.delete(msg)));
			
			// Delete conversation record (may not exist for new conversations)
			const [userId, roomId] = room.split('/');
			try {
				await infra.conversations.delete({ userId, roomId });
			} catch (error) {
				// Conversation record may not exist yet for new conversations
				console.log('Conversation record not found, which is OK for new conversations');
			}
			
			return { success: true };
		}
	}))
};