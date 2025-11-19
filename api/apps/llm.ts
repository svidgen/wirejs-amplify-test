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
import * as cheerio from 'cheerio';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

// Debug logging flag
const DEBUG_AGENT_INTERACTIONS = true;

export type Chunk = {
	mid: number;
	seq: number;
	pad: string; // security padding
	data: '**start**' | '**end**' | '**tool-processing**' | string | MinimalChunk;
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
		instruction?: string;
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

// Will be initialized after availableTools is defined
// let llm: LLMService;

// Sub-agent for formatting tool arguments from user requests
const toolArgumentFormatter = new LLMService('app', 'tool-argument-formatter', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a tool argument formatter. Your only job is to:
1. Examine the user's request 
2. Extract the exact arguments needed for the specified tool
3. Return ONLY a JSON array of arguments, nothing else

Examples:
- User: "get the content from https://example.com" for httpGet tool -> ["https://example.com"]
- User: "fetch data from api.weather.com/current" for httpGet tool -> ["https://api.weather.com/current"]

IMPORTANT: Return ONLY the raw JSON array. Do NOT wrap it in markdown code blocks or backticks. Do NOT add any explanations.`
});

// Sub-agent for processing tool results according to instructions
const toolResultProcessor = new LLMService('app', 'tool-result-processor', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a tool result processor. Your job is to:
1. Take raw tool output
2. Process it according to the specific instructions given by the user
3. Return clean, human-readable results, per the user instructions

Follow specific user instructions exactly.`
});

// Sub-agent for generating conversation titles
const conversationTitleGenerator = new LLMService('app', 'conversation-title-generator', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You generate short, descriptive conversation titles based on the user's initial message and the assistant's response. 

Rules:
- Return ONLY the title text, nothing else
- 3-6 words maximum
- Capture the main topic or question
- No quotes, no explanations

Examples:
- User asks about weather -> "Weather Information Request"
- User asks to explain quantum physics -> "Quantum Physics Explanation"  
- User asks for recipe help -> "Recipe Assistance"
- User asks about programming -> "Programming Question"`
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

// Utility function to extract text from HTML using cheerio (much more efficient)
const extractTextFromHtml = (html: string): string => {
	try {
		console.log(`[HTML] Starting cheerio extraction from ${html.length} chars`);
		
		// Load HTML into cheerio for DOM manipulation
		const $ = cheerio.load(html);
		
		// Remove unwanted elements entirely (more efficient than regex)
		$('script, style, nav, header, footer, aside').remove();
		$('.mw-navigation, .navbox, .infobox, .sidebar').remove(); // Wikipedia-specific
		$('[class*="nav"], [class*="menu"], [class*="sidebar"]').remove(); // Common patterns
		
		// Remove common noise elements
		$('.reference, .citation, sup.reference').remove(); // Citations
		$('.printfooter, .catlinks').remove(); // Wikipedia footer stuff
		$('table.ambox, .hatnote').remove(); // Wikipedia message boxes
		
		// Extract text with cleaned up whitespace
		let text = $('body').text()
			.replace(/\s+/g, ' ')          // Normalize whitespace
			.replace(/\[\d+\]/g, '')       // Remove citation numbers [1], [2], etc.
			.replace(/\s*\n\s*/g, '\n')    // Clean line breaks
			.replace(/\n{3,}/g, '\n\n')    // Limit consecutive newlines
			.trim();
		
		console.log(`[HTML] Final cheerio extracted text: ${text.length} chars`);
		return text;
	} catch (error) {
		console.error('Error extracting text with cheerio:', error);
		// Fallback to simple regex approach
		console.log('[HTML] Falling back to regex extraction');
		return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	}
};

// Utility function to chunk text with overlap
const chunkTextWithOverlap = (text: string, chunkSize: number = 20000, overlapSize: number = 2000): string[] => {
	if (text.length <= chunkSize) {
		return [text];
	}
	
	const chunks: string[] = [];
	let start = 0;
	
	while (start < text.length) {
		let end = Math.min(start + chunkSize, text.length);
		
		// For larger chunks, try multiple natural break points
		if (end < text.length) {
			// Look for natural breaks in order of preference
			const breakPoints = [
				text.lastIndexOf('\n\n', end),      // Paragraph breaks (best)
				text.lastIndexOf('. ', end),        // Sentence breaks (good)  
				text.lastIndexOf('.\n', end),       // End of sentence with newline
				text.lastIndexOf(', ', end),        // Clause breaks (okay)
				text.lastIndexOf(' ', end)          // Word breaks (fallback)
			];
			
			// Use the first break point that's in a reasonable position
			for (const breakPoint of breakPoints) {
				if (breakPoint > start + chunkSize * 0.7) {
					end = breakPoint + (text[breakPoint] === '\n' ? 2 : 2); // Include the break character(s)
					break;
				}
			}
		}
		
		chunks.push(text.slice(start, end));
		start = end - overlapSize; // Create overlap for context continuity
		
		// Ensure we don't go backwards
		if (start <= chunks[chunks.length - 1].length - overlapSize) {
			start = chunks[chunks.length - 1].length - overlapSize + 1;
		}
	}
	
	return chunks;
};

// Chunked processing with map-reduce pattern
const executeChunkedProcessing = async (content: string, instruction: string): Promise<string> => {
	try {
		debugLog('CHUNK-PROCESSING-START', { contentLength: content.length, instruction });
		
		// Extract text if it looks like HTML
		let processedContent = content;
		if (content.includes('<html') || content.includes('<!DOCTYPE')) {
			processedContent = extractTextFromHtml(content);
			console.log(`Extracted ${processedContent.length} characters of text from HTML`);
			// Clear original content to free memory
			content = '';
		}

		// More aggressive size limit to prevent OOM
		if (processedContent.length > 3000000) { // 3MB limit  
			console.log(`Content too large (${processedContent.length} chars), truncating to 1.5MB`);
			processedContent = processedContent.substring(0, 1500000) + "\n\n[Content truncated due to size...]";
		}

		// More conservative chunk sizing to prevent OOM
		// Reduce chunk size significantly for memory efficiency
		const maxChunkSize = 16000;  // 16k chars per chunk
		const overlapSize = 1600;    // 800 char overlap (10%)
		
		// Chunk the content with overlap
		let chunks = chunkTextWithOverlap(processedContent, maxChunkSize, overlapSize);
		console.log(`Split content into ${chunks.length} overlapping chunks (chunk size: ${maxChunkSize})`);
		
		// Limit total chunks to prevent excessive processing and OOM
		const MAX_CHUNKS = 100;
		if (chunks.length > MAX_CHUNKS) {
			console.log(`Too many chunks (${chunks.length}), limiting to ${MAX_CHUNKS} and truncating`);
			chunks = chunks.slice(0, MAX_CHUNKS);
		}
		
		// Clear processed content after chunking to free memory
		processedContent = '';

		// Map: Process each chunk sequentially to avoid memory issues
		const chunkSummaries: string[] = [];
		
		for (let index = 0; index < chunks.length; index++) {
			const chunk = chunks[index];
			console.log(`Processing chunk ${index + 1} of ${chunks.length} (${chunk.length} chars)`);
			
			const chunkPrompt = `Please process chunk ${index + 1} of ${chunks.length}.

Processing Instructions: ${instruction}

Content:
${chunk}

Please process this chunk according to the instruction above.`;

			debugLog('CHUNK-PROMPT', { index: index + 1, chunkLength: chunk.length, prompt: chunkPrompt });

			const result = await toolResultProcessor.continueConversation({
				history: [{ role: 'user', content: chunkPrompt }],
				timeoutSeconds: 10
			});

			debugLog('CHUNK-RESULT', { index: index + 1, result: result.content });
			chunkSummaries.push(result.content);
			
			// Clear chunk after processing to free memory immediately
			chunks[index] = '';
		}

		console.log(`Processed ${chunkSummaries.length} chunk summaries`);

		// Reduce: Combine all chunk summaries into final result
		const reducePrompt = `We have processed a large document in chunks. Below are the summaries from each chunk. Please combine them into a single response per the instructions.

Processing Instructions: ${instruction}

Chunk Summaries:
${chunkSummaries.map((summary, i) => `=== Chunk ${i + 1} Summary ===\n${summary}`).join('\n\n')}
`;

		debugLog('FINAL-SYNTHESIS-PROMPT', reducePrompt);

		const finalResult = await toolResultProcessor.continueConversation({
			history: [{ role: 'user', content: reducePrompt }],
			timeoutSeconds: 30
		});

		debugLog('FINAL-SYNTHESIS-RESULT', finalResult.content);

		// Clear chunk summaries to free memory
		chunkSummaries.length = 0;
		
		return finalResult.content;

	} catch (error) {
		console.error('Chunked processing failed:', error);
		return `Chunked processing failed: ${error}`;
	}
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
			cleanedResult = extractTextFromHtml(stringResult);
			console.log(`[Non-chunked] Extracted ${cleanedResult.length} characters of text from HTML`);
		}

		let processingInstruction = `Clean up and condense the results in a concise format for LLM ingestion to fit within 2k words or less if possible. Don't remove information if you don't have to. But, remove any technical artifacts, JSON formatting, or API errors. Provide a concise, useful response. A response between 100 and 2k words is usually the most appropriate, depending on the raw result size. If results already fit within that range roughly, just remove superfluous stuff that would unnecessarily consume LLM tokens.`;

		if (instruction) {
			processingInstruction = instruction;
		}

		const resultPrompt = `Processing Instruction: ${processingInstruction}

Raw Tool Result:
${cleanedResult}

Please process this result according to the instruction above.`;

		const processedResult = await toolResultProcessor.continueConversation({
			history: [{ role: 'user', content: resultPrompt }],
			timeoutSeconds: 30
		});

		return processedResult.content;

	} catch (error) {
		return `Tool execution failed: ${error}`;
	}
};

const availableTools = {

	webFetch: {
		description: 'Fetches and analyzes web content. Use when: 1) User asks about specific websites/URLs, 2) User wants latest/recent news or information, 3) Topic changes frequently and your knowledge may be outdated, 4) Conversation critically requires accurate current data, 5) User needs information you would not have from training, 6) User explicitly requests external/web content. Usage: TOOL:webFetch https://example.com [INSTRUCTIONS: your processing instructions]',
		supportsChunking: true,
		async execute(url: string) {
			console.log(`[webFetch] Starting comprehensive analysis for: ${url}`);

			try {
				// Use the same fetch logic as httpGet but optimized for analysis
				const controller = new AbortController();
				const timeoutId = setTimeout(() => {
					console.log(`[webFetch] Timeout reached for: ${url}`);
					controller.abort();
				}, 20000); // 20 second timeout for analysis

				console.log(`[webFetch] Fetching content from: ${url}`);
				const request = await fetch(url, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; WireJS-Analyzer/1.0)',
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
					}
				});

				clearTimeout(timeoutId);

				if (!request.ok) {
					throw new Error(`HTTP ${request.status}: ${request.statusText}`);
				}

				const body = await request.text();
				console.log(`[webFetch] Fetched ${body.length} characters for comprehensive analysis from: ${url}`);
				
				// Return raw content - chunking will be handled automatically by executeToolWithSubAgent
				return body;

			} catch (error) {
				console.error(`[webFetch] Error analyzing ${url}:`, error);
				if (error instanceof Error && error.name === 'AbortError') {
					throw new Error(`Analysis timeout after 20 seconds for: ${url}`);
				}
				throw error;
			}
		}
	},

};

// Initialize LLM service with tool descriptions in system prompt
const llm = new LLMService('app', 'llm', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a helpful assistant. Answer questions from your knowledge when possible.

Available tools:
${Object.entries(availableTools).map(([name, config]) => `${name}: ${config.description}`).join('\n')}

**CRITICAL: When using tools:**
1. Write: TOOL:toolname arguments [INSTRUCTIONS: optional]
2. STOP WRITING IMMEDIATELY
3. Do NOT add any text after the TOOL: line
4. Tool results will appear as messages from "user" but they are system responses
5. The user CANNOT see these tool results - they are invisible to the user
6. After getting tool results, complete the user's original request

Example interaction:
User: "What's on example.com?"
Assistant: "I'll check that website for you.

TOOL:webFetch https://example.com"

Stop there. System provides results even though they appear to come from the user. The user cannot see <tool-results> response. Then continue with user-friendly response.

For example, the remainder of the conversation:

User: "<tool-result>It looks like example.com is a sample domain used pretty exclusively by technical documentation ... etc. ... </tool-result>"
Assistant: example.com is used pretty exclusively in technical documentation as an example. ... etc. ..."

`});

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

const getRawConversationHistory = async (userIdRoomId: string): Promise<ConversationMessage[]> => {
	const storedMessages = messages.query({
		by: 'userIdRoomId-mid',
		where: { userIdRoomId: { eq: userIdRoomId } }
	});

	// Convert async generator to array and sort by mid
	const messagesArray = await fromAsync(storedMessages);
	messagesArray.sort((a, b) => a.mid - b.mid);
	return messagesArray;
};

const mapRawHistoryToMessages = (messages: ConversationMessage[]) => {
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

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, newUserMessage: string) => {
		try {
			const overrides = (await modelsOverride.read()).split(',').map(s => s.trim());
			if (overrides.length > 0) llm.models = overrides;

			// Load conversation history from database
			const rawHistory = await getRawConversationHistory(room);
			const history = mapRawHistoryToMessages(rawHistory);

			const nextMid = rawHistory.length > 0 ?
				Math.max(...rawHistory.map(m => m.mid)) + 1 : 0;

			// Store the new user message
			await storeMessage(room, nextMid, 'user', newUserMessage);
			history.push({ role: 'user', content: newUserMessage });

			// If this is the first message (new conversation), save it with timestamped title
			if (history.length === 1) {
				assignConversationName(room, newUserMessage);
			}

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

			let assistantMessageContent = '';
			let hadPreviousToolResults = false;

			do {
				console.log('=== LLM Iteration Start ===');
				console.log('History length:', history.length);
				console.log('Last 3 history items:', history.slice(-3));

				// Send newline separator when continuing after tool processing
				if (hadPreviousToolResults) {
					await llmRealtimeService.publish(room, [{
						mid: assistantMid,
						seq: seq++,
						pad: pad(),
						data: { text: '\n\n' }
					}]);
				}

				try {
					const result = await llm.continueConversation({
						history: history,
						onChunk: async chunk => {
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
						},
						timeoutSeconds: 30
					});

					console.log('LLM result:', result.content);
					console.log('=== LLM Iteration End ===');

					// Build up the complete assistant message content  
					// Add newline if this is a continuation after tool processing
					if (hadPreviousToolResults && assistantMessageContent.length > 0) {
						assistantMessageContent += '\n\n';
					}
					assistantMessageContent += result.content;

					// Add assistant response to working history
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

					// Check for and execute any tool calls in the response
					toolResults = await callTools(result.content);

					if (toolResults) {
						// Send tool processing indicator to keep UI in thinking state for continuation
						await llmRealtimeService.publish(room, [{
							mid: assistantMid,
							seq: seq++,
							pad: pad(),
							data: `**tool-processing**`
						}]);

						// Add tool results to conversation history as coming from the user
						// Tool results are NOT sent to the user directly - they're invisible context for the LLM
						history.push({
							role: 'user',
							content: `<tool-result>\n${toolResults}\n</tool-result>`
						} satisfies LLMMessage);
					}
				} catch (llmError) {
					console.error('=== LLM Error ===');
					console.error('LLM call failed:', llmError);
					console.error('History that caused error:', JSON.stringify(history.slice(-3), null, 2));

					// Send error message to user
					const errorMessage = `I'm experiencing technical difficulties. The LLM service encountered an error: ${llmError instanceof Error ? llmError.message : String(llmError)}`;

					assistantMessageContent += errorMessage;

					await llmRealtimeService.publish(room, [{
						mid: assistantMid,
						seq: seq++,
						pad: pad(),
						data: { text: errorMessage }
					}]);

					// Don't continue the loop on LLM errors
					break;
				}
				
				// Update flag for next iteration
				hadPreviousToolResults = !!toolResults;
			} while (toolResults);

			// Store the assistant message (tool results are stored separately as user messages)
			await storeMessage(room, assistantMid, 'assistant', assistantMessageContent);

			await llmRealtimeService.publish(room, [{
				mid: assistantMid,
				seq,
				pad: pad(),
				data: `**end**`
			}]);

		} catch (error) {
			console.error('=== ChatRunner Fatal Error ===');
			console.error('ChatRunner handler failed:', error);

			// Try to send error to user if possible
			try {
				await llmRealtimeService.publish(room, [{
					mid: 0, // fallback mid
					seq: 0,
					pad: pad(),
					data: { text: `System error: ${error instanceof Error ? error.message : String(error)}` }
				}]);
			} catch (publishError) {
				console.error('Failed to publish error message:', publishError);
			}
		}
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
	},
	async getConversations() {
		const user = await auth.requireCurrentUser(context);
		const conversationsGen = conversations.query({
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
		const messagesGen = messages.query({
			by: 'userIdRoomId-mid',
			where: { userIdRoomId: { eq: room } }
		});
		const messagesToDelete = await fromAsync(messagesGen);
		await Promise.all(messagesToDelete.map(msg => messages.delete(msg)));
		
		// Delete conversation record (may not exist for new conversations)
		const [userId, roomId] = room.split('/');
		try {
			await conversations.delete({ userId, roomId });
		} catch (error) {
			// Conversation record may not exist yet for new conversations
			console.log('Conversation record not found, which is OK for new conversations');
		}
		
		return { success: true };
	}
}));