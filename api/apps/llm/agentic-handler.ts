import { Infra } from './infra.js'

export const agenticHandler = (infra: Infra) => async (
	room: string,
	newUserMessage: string
) => {
	try {
		const overrides = (await infra.modelSetting.read()).split(',').map(s => s.trim());
		if (overrides.length > 0) infra.llm.models = overrides;

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
};