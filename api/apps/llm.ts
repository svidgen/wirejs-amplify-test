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
let llm: LLMService;

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

const callTools = async (message: string): Promise<string | undefined> => {
	try {
		const toolCalls: { tool: string; args: any[]; instruction?: string }[] = [];

		console.log(`[callTools] Processing message: "${message}"`);

		// Skip processing if message contains tool results (already processed or hallucinated)
		if (message.includes('<tool-result>')) {
			console.log(`[callTools] Skipping message with existing tool results - this may be LLM hallucination`);
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

			console.log(`[callTools] Full regex match:`, match);
			console.log(`[callTools] Parsed: toolName="${toolName}", toolArgs="${toolArgs}", instruction="${instruction}"`);

			if (availableTools.hasOwnProperty(toolName)) {
				toolCalls.push({
					tool: toolName,
					args: [toolArgs],
					instruction
				});
				console.log(`[callTools] Added tool call:`, { tool: toolName, args: [toolArgs], instruction });
			} else {
				console.log(`[callTools] Tool not found: ${toolName}`);
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
		
		console.log(`[HTML] After removing unwanted elements`);
		
		// Extract text from main content areas first (prioritize quality content)
		let text = '';
		
		// Try to get main content first (Wikipedia and other sites)
		const mainContent = $('#mw-content-text, .mw-parser-output, main, article, .content');
		if (mainContent.length > 0) {
			text = mainContent.first().text();
		} else {
			// Fallback: get all text from body
			text = $('body').text();
		}
		
		// Clean up whitespace efficiently
		text = text
			.replace(/\s+/g, ' ')                    // Normalize whitespace
			.replace(/\[\d+\]/g, '')                 // Remove citation numbers [1], [2], etc.
			.replace(/\s*\n\s*/g, '\n')             // Clean line breaks
			.replace(/\n{3,}/g, '\n\n')             // Limit consecutive newlines
			.trim();
		
		// Remove common Wikipedia noise patterns
		text = text
			.replace(/\s*(Coordinates|Categories|References|External links|See also):.*$/gim, '')
			.replace(/\s*\[(edit|citation needed|clarification needed)\]/gi, '')
			.replace(/\s*(Cookie|Privacy Policy|Terms of Service|Subscribe|Newsletter|Advertisement)[^\n]*/gi, '');
		
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
		const overlapSize = 800;    // 800 char overlap (10%)
		
		// Chunk the content with overlap
		let chunks = chunkTextWithOverlap(processedContent, maxChunkSize, overlapSize);
		console.log(`Split content into ${chunks.length} overlapping chunks (chunk size: ${maxChunkSize})`);
		
		// Limit total chunks to prevent excessive processing and OOM
		const MAX_CHUNKS = 25; // Reasonable limit for memory and processing time
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
			
			const chunkPrompt = `Processing chunk ${index + 1} of ${chunks.length}.

Instruction: ${instruction}

Chunk Content:
${chunk}

Please process this chunk according to the instruction above. Focus on extracting key information and insights.`;

			const result = await toolResultProcessor.continueConversation({
				history: [{ role: 'user', content: chunkPrompt }],
				timeoutSeconds: 30 // Reduced timeout for smaller chunks
			});

			chunkSummaries.push(result.content);
			
			// Clear chunk after processing to free memory immediately
			chunks[index] = '';
			
			// Force garbage collection if available and longer delay
			if (global.gc) {
				global.gc();
			}
			await new Promise(resolve => setTimeout(resolve, 200));
		}

		console.log(`Processed ${chunkSummaries.length} chunk summaries`);

		// Reduce: Combine all chunk summaries into final result
		const reducePrompt = `You have processed a large document in chunks. Below are the summaries from each chunk. Please combine them into a comprehensive, well-organized final response.

Original Instruction: ${instruction}

Chunk Summaries:
${chunkSummaries.map((summary, i) => `=== Chunk ${i + 1} Summary ===\n${summary}`).join('\n\n')}

Please create a final, comprehensive response that synthesizes all the information from the chunks above.`;

		const finalResult = await toolResultProcessor.continueConversation({
			history: [{ role: 'user', content: reducePrompt }],
			timeoutSeconds: 45 // Reduced timeout 
		});

		// Clear chunk summaries to free memory
		chunkSummaries.length = 0;
		
		return finalResult.content;

	} catch (error) {
		console.error('Chunked processing failed:', error);
		return `Chunked processing failed: ${error}`;
	}
};

// Three-step tool execution with specialized sub-agents
const executeToolWithSubAgent = async (toolName: string, userRequest: string, instruction?: string): Promise<string> => {
	const tool = (availableTools as any)[toolName];
	if (!tool) {
		throw new Error(`Tool ${toolName} not found`);
	}

	try {
		console.log(`executeToolWithSubAgent - toolName: ${toolName}, userRequest: "${userRequest}"`);

		// Step 1: Format tool arguments using dedicated sub-agent
		const argsPrompt = `Tool: ${toolName}
Tool Description: ${tool.description}
User Request: ${userRequest}

Extract the arguments needed for this tool and return as a JSON array.`;

		console.log('Sending to argument formatter:', argsPrompt);

		const argsResult = await toolArgumentFormatter.continueConversation({
			history: [{ role: 'user', content: argsPrompt }],
			timeoutSeconds: 30
		});

		console.log('Argument formatter response:', argsResult.content);

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
		console.log(`Tool returned ${typeof rawResult === 'string' ? rawResult.length + ' characters' : typeof rawResult}`);

		// Step 3: Check if chunking is needed based on content size
		const shouldChunk = typeof rawResult === 'string' && rawResult.length > 8000;
		
		if (shouldChunk && tool.supportsChunking !== false) {
			console.log('Large content detected, using chunked processing');
			const chunkInstruction = instruction || 'Summarize and extract key information from this content.';
			const result = await executeChunkedProcessing(rawResult, chunkInstruction);
			return result;
		}

		// Step 3: Process results using dedicated sub-agent (standard path)
		let processingInstruction = `Clean up and summarize the results in a human-readable format. Remove any technical artifacts, JSON formatting, or API errors. Provide a concise, useful response.`;

		if (instruction) {
			processingInstruction = instruction;
		}

		const resultPrompt = `Processing Instruction: ${processingInstruction}

Raw Tool Result:
${rawResult}

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
		description: [
			'Fetches web pages and processes information according to instructions.',
			"Use this tool when it is NECESSARY to fulfill the user's request with information from the web.",
			'Example:\nTOOL:webFetch https://example.com/some-page [INSTRUCTIONS: summarize and extract the most important quotes]\n'
		].join(' '),
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
llm = new LLMService('app', 'llm', {
	models: ['llama3.2', 'llama3:8b', 'llama2'],
	systemPrompt: `You are a helpful assistant. Answer questions directly from your knowledge whenever possible.

Use tools when you need external data. Examples of when external data is required:

1. Direct user request about a specific site or URL
2. "Latest" information or "news" about a topic
3. Topic inherently grows stale quickly and/or your own knowledge which is years old may be out of date
4. The conversational context critically warrants accurate information
5. Knowledge that you simply would not have gained during normal LLM training
6. Need to explicitly read or write to an external system (if such tools are available)

In almost all other cases, just respond as yourself.

Available tools:
${Object.entries(availableTools).map(([name, config]) => `${name}: ${config.description}`).join('\n')}

To use a tool: Write "TOOL:toolname arguments" on its own line, then stop writing immediately.

IMPORTANT: After writing the "TOOL: ..." line, STOP RESPONDING!!! The user will provide the tool response -- it's actually a system response that the user cannot see. But, it will appear to come from the user.
`
});

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

const getConversationHistory = async (userIdRoomId: string): Promise<LLMMessage[]> => {
	const storedMessages = messages.query({
		by: 'userIdRoomId-mid',
		where: { userIdRoomId: { eq: userIdRoomId } }
	});

	const llmHistory: LLMMessage[] = [];

	// Convert async generator to array and sort by mid
	const messagesArray = await fromAsync(storedMessages);
	messagesArray.sort((a, b) => a.mid - b.mid);

	for (const msg of messagesArray) {
		if (msg.role === 'user' || msg.role === 'assistant') {
			llmHistory.push({
				role: msg.role,
				content: msg.content
			});
		}
		// Note: tool-result messages are not stored as persistent conversation records
		// They exist only transiently in the conversation history during tool processing
	}

	return llmHistory;
};

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

const chatRunner = new BackgroundJob('app', 'chatRunner', {
	handler: async (room: string, newUserMessage: string) => {
		try {
			const overrides = (await modelsOverride.read()).split(',').map(s => s.trim());
			if (overrides.length > 0) llm.models = overrides;

			// Load conversation history from database
			const history = await getConversationHistory(room);

			// Get the next message ID by finding the highest existing mid
			const existingMessagesGen = messages.query({
				by: 'userIdRoomId-mid',
				where: { userIdRoomId: { eq: room } }
			});
			const existingMessages = await fromAsync(existingMessagesGen);
			const nextMid = existingMessages.length > 0 ?
				Math.max(...existingMessages.map(m => m.mid)) + 1 : 0;

			// Store the new user message
			await storeMessage(room, nextMid, 'user', newUserMessage);
			history.push({ role: 'user', content: newUserMessage });

			// If this is the first message (new conversation), save it with timestamped title
			if (history.length === 1) {
				const [userId] = room.split('/');
				const [, roomId] = room.split('/');
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

			do {
				console.log('=== LLM Iteration Start ===');
				console.log('History length:', history.length);
				console.log('Last 3 history items:', history.slice(-3));

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
			} while (toolResults);

			// Store the assistant message (tool results are stored separately as user messages)
			await storeMessage(room, assistantMid, 'assistant', assistantMessageContent);

			// Generate conversation title after first exchange (if this is a new conversation)
			if (history.length === 2) { // User message + first assistant response
				try {
					const titlePrompt = `User: ${newUserMessage}\n\nAssistant: ${assistantMessageContent}\n\nGenerate a short title for this conversation:`;
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
					const [userId] = room.split('/');
					const [, roomId] = room.split('/');
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