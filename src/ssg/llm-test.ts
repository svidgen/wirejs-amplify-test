import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, css, hydrate, list, text, node } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { llm, Chunk, ChunkData, Conversation } from 'internal-api';

type Role = 'assistant' | 'user';

const sheet = css`
	.messages {
		height: calc(100vh - 30rem);
		overflow: scroll;
	}
	.flex-row {
		display: flex;
		flex-direction: row;
	}
	.flex-row > textarea {
		margin-right: 10px;
	}
`;

function formatMessage(message: string): string {
	// Remove tool result tags and their content from user-facing display
	let cleanedMessage = message.replace(/<tool-result>[\s\S]*?<\/tool-result>/g, '');
	
	// Only remove TOOL: calls that appear to be complete (followed by newline or end of string)
	// This prevents partial filtering of incomplete chunks
	cleanedMessage = cleanedMessage.replace(/TOOL:\w+\s+[^\[\r\n]+?(?:\s*\[INSTRUCTION:\s*[^\]]+\])?\s*(?:\n|$)/g, '');
	
	return DOMPurify.sanitize(marked.parse(cleanedMessage) as string);
}

class Message {
	private chunks: Chunk[] = [];
	private originalContent: string = '';

	view = html`<div style='margin-top: 1em;'>
		<b>${text('role', 'Assistant' as Role)}</b>
		<br />
		${node('body', md => html`<div>${md}</div>`)}
	</div>`;

	constructor(role: Role, body: string = '', isDone: boolean = true) {
		this.isDone = isDone;
		this.role = role;
		this.originalContent = body;
		this.view.data.body = formatMessage(body);
	}

	get isDone() {
		return this.view.classList.contains('done');
	}

	set isDone(isDone: boolean) {
		if (isDone) {
			this.view.classList.add('done');
		} else {
			this.view.classList.remove('done');
		}
	}

	get role(): Role {
		return this.view.data.role as Role;
	}

	set role(role: Role) {
		this.view.data.role = role;
	}

	// Returns the original unformatted content
	get content(): string {
		return this.originalContent;
	}

	// Returns the formatted HTML body for display
	get body() {
		return this.view.data.body;
	}

	set body(content: string) {
		this.originalContent = content;
		this.view.data.body = formatMessage(content);
	}

	appendChunk(chunk: Chunk) {
		this.chunks.push(chunk);
		this.chunks.sort((a, b) => a.seq > b.seq ? 1 : -1);

		let md: string[] = [];
		for (const c of this.chunks) {
			if (c.data.type === 'text') {
				md.push(c.data.text);
			}
		}

		const newContent = md.join('');
		this.originalContent = newContent;
		// Don't filter here - let formatMessage() handle filtering on render
		this.view.data.body = formatMessage(newContent);

		if (chunk.data.type === 'start') {
			this.isDone = false;
		} else if (chunk.data.type === 'end') {
			this.isDone = true;
		} else if (chunk.data.type === 'status' || chunk.data.type === 'title') {
			// Keep the message in processing state during tool calls
			this.isDone = false;
		}
	}
}

async function Chat() {
	const messageIndex = new Map<number, Message>();

	const self = html`<div id='chat'>
		${sheet}

		<!-- Conversation Management -->
		<div style='margin-bottom: 1em; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;'>
			<label style='font-weight: bold;'>Conversations:</label>
			<select ${id('conversationSelect', HTMLSelectElement)} style='min-width: 200px;'>
				<option value="">New Conversation</option>
			</select>
			<button ${id('newConversationBtn', HTMLButtonElement)} style='padding: 5px 10px;'>New</button>
			<button ${id('deleteConversationBtn', HTMLButtonElement)} style='padding: 5px 10px; background-color: #dc3545; color: white; border: none; border-radius: 3px;' disabled>Delete</button>
		</div>

		<!-- All messages. Markdown formatted. Sanitized. -->
		<div ${id('messageContainer', HTMLDivElement)} class='messages'>
			${list('messages', (m: Message) => m.view)}
			${node('messageStatus', (md) => md ? html`<div style='color: #333;'>
				${formatMessage(md || '')}
			</div>` : html`<div></div>`)}
		</div>

		<!-- New message form -->
		<form ${id('messageForm', HTMLFormElement)}
			onsubmit=${async (event: Event) => {
				event.preventDefault();
				if (!self.activeRoom) {
					await self.createConversation();
				}
				
				const userMessage = self.data.message.value.trim();
				if (!userMessage) return;
				
				// Add user message to UI with original text
				self.data.messages.push(new Message('user', userMessage));
				self.data.message.value = '';
				self.data.message.disabled = true;
				self.data.submitButton.disabled = true;
				self.data.message.style.height = 'auto';
				self.data.messageStatus = '<i>Thinking ...</i>';
				self.autoscroll();
				
				// Send only the latest user message to the server
				llm.send(null, self.activeRoom!, userMessage).catch(error => {
					console.error(error);
					self.data.status = 'Error. Try again.';
					self.data.message.disabled = false;
					self.data.submitButton.disabled = false;
					self.data.messageStatus = '';
				});
			}}
		><div class='flex-row'>
			<textarea
				${id('message', HTMLTextAreaElement)}
				autocomplete="on"
				autocorrect="on"
				autocapitalize="on"
				type='text'
				style="
					width: calc(100% - 5rem);
					height: auto;
					tab-size: 4;
				"
				oninput=${() => {
					// reset height to auto to calculate scrollHeight correctly
					self.data.message.style.height = 'auto';
					// only then set it to scrollHeight, which will not be based on the raw
					// height of the content, excluding padding, etc.
					self.data.message.style.height = self.data.message.scrollHeight + 'px';
				}}
				onkeydown=${(event: KeyboardEvent) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						self.data.messageForm.dispatchEvent(new Event('submit'));
					}
					if (event.key === 'Tab') {
						event.preventDefault();
						const textarea = self.data.message;
						const start = textarea.selectionStart;
						const end = textarea.selectionEnd;
						if (start === end) {
							// If no selection, insert a tab at the cursor position
							textarea.value = textarea.value.substring(0, start)
								+ '\t' + textarea.value.substring(end);
							textarea.selectionStart = textarea.selectionEnd = start + 1;
							return;
						}
						let lines = textarea.value.split('\n');
						const selectedLines = lines.slice(
							textarea.value.substring(0, start).split('\n').length - 1,
							textarea.value.substring(0, end).split('\n').length
						);
						let updatedLines = [];
						let selectionStartOffset = 0;
						if (event.shiftKey) {
							updatedLines = selectedLines.map(line => line.startsWith('\t') ? line.substring(1) : line);
							selectionStartOffset = -1;
						} else {
							updatedLines = selectedLines.map(line => '\t' + line);
							selectionStartOffset = 1;
						}
						lines.splice(
							start === end ? start : textarea.value.substring(0, start).split('\n').length - 1,
							selectedLines.length,
							...updatedLines
						);
						textarea.value = lines.join('\n');
						textarea.selectionStart = start + selectionStartOffset;
						textarea.selectionEnd = end + updatedLines.length;
					}
				}}
			></textarea>
			<input ${id('submitButton', HTMLInputElement)}
				type='submit' value='&gt;' style='width: 2em; height: 2em;' />
		</div></form>

		<!-- Connection status -->
		<span style='color: var(--color-muted)'>${text('status', 'Just waiting for you!')}</span>

	</div>`.extend(() => ({
		activeRoom: undefined as string | undefined,
		conversations: [] as Conversation[],
		
		isScrolledDownWithinMargin(margin: number) {
			const container = self.data.messageContainer;
			const scrollTop = container.scrollTop;
			const scrollHeight = container.scrollHeight;
			const clientHeight = container.clientHeight;
			return (scrollHeight - (scrollTop + clientHeight)) <= margin;
		},
		autoscroll() {
			const container = self.data.messageContainer;
			container.scrollTop = container.scrollHeight - container.clientHeight;
		},
		disconnect() {
			// Will be replaced with actual unsubscribe function when connected
		},
		
		async loadConversations() {
			try {
				self.conversations = await llm.getConversations(null);
				const select = self.data.conversationSelect;
				
				// Clear existing options except the first one
				while (select.options.length > 1) {
					select.remove(1);
				}
				
				// Add conversation options
				for (const conv of self.conversations) {
					const option = document.createElement('option');
					option.value = conv.conversationId;
					option.text = conv.name;
					select.add(option);
				}
			} catch (error) {
				console.error('Failed to load conversations:', error);
			}
		},

		async createConversation() {
			try {
				// New conversation - just create room, don't save to database yet
				self.disconnect(); 
				self.activeRoom = await llm.createRoom(null);
				self.data.messages.splice(0); // Clear messages
				messageIndex.clear();
				
				// Set dropdown to show "New Conversation" but don't add permanent entry yet
				self.data.conversationSelect.value = "";
				self.data.deleteConversationBtn.disabled = true; // Can't delete unsaved conversations
				await self.connect();
				return;
			} catch (error) {
				console.error('Failed to create conversation:', error);
				self.data.status = 'Error creating conversation.';
			}
		},
		
		async loadConversation(roomId: string) {
			try {
				if (roomId !== self.activeRoom) {
					// reset states to blank.
					self.activeRoom = undefined;
					self.disconnect();
					self.data.messages.splice(0);
					messageIndex.clear();
				}

				if (roomId) {
					// Load conversation history
					const history = await llm.getHistory(null, roomId);
					for (const msg of history) {
						const message = new Message(msg.role as 'user' | 'assistant', msg.content);
						self.data.messages.push(message);
					}
					
					// Set active room and connect
					self.activeRoom = roomId;
					await self.connect();
				}
				
				self.data.conversationSelect.value = roomId;
				self.data.deleteConversationBtn.disabled = false;
				self.autoscroll();
			} catch (error) {
				console.error('Failed to load conversation:', error);
				self.data.status = 'Error loading conversation.';
			}
		},
		
		async deleteCurrentConversation() {
			if (!self.activeRoom) return;
			
			try {
				await llm.deleteConversation(null, self.activeRoom);
				
				// Clear UI and start new conversation
				self.data.messages.splice(0);
				messageIndex.clear();
				self.data.conversationSelect.value = "";
				self.data.deleteConversationBtn.disabled = true;
				self.activeRoom = undefined;
				
				// Create new room
				self.disconnect();
				
				// Reload conversation list
				await self.loadConversations();
			} catch (error) {
				console.error('Failed to delete conversation:', error);
				self.data.status = 'Error deleting conversation.';
			}
		},
		
		updateConversationTitle(newTitle: string) {
			// Update the dropdown option for the current conversation
			const select = self.data.conversationSelect;
			let currentOption = Array.from(select.options).find(opt => opt.value === self.activeRoom);
			
			// If no option exists yet (new conversation getting its first title), create it
			if (!currentOption && self.activeRoom) {
				currentOption = document.createElement('option');
				currentOption.value = self.activeRoom;
				currentOption.text = newTitle;
				select.add(currentOption, 1); // Add after "New Conversation" option
				select.value = self.activeRoom;
				
				// Enable delete button now that conversation is saved
				self.data.deleteConversationBtn.disabled = false;
			} else if (currentOption) {
				// Update existing option
				currentOption.text = newTitle;
			}
		},
		async connect() {
			if (!self.activeRoom) {
				console.error('No active room to connect to');
				return;
			}
			
			// Disconnect any existing connection first
			self.disconnect();
			
			const roomStream = await llm.getRoom(null, self.activeRoom);
			self.disconnect = roomStream.subscribe({
				onopen() {
					self.data.status = `Connected.`;
				},
				onmessage(chunk) {
					const startedAtBottom = self.isScrolledDownWithinMargin(50);
					
					// Handle special title update messages
					if (chunk.data.type === 'title') {
						const newTitle = chunk.data.value;
						self.updateConversationTitle(newTitle);
						return;
					}

					if (chunk.data.type === 'start') {
						self.data.messageStatus = '💫 Thinking ...';
						return;
					}

					let message: Message;
					if (messageIndex.has(chunk.mid)) {
						message = messageIndex.get(chunk.mid)!;
					} else {
						message = new Message('assistant');
						self.data.messages.push(message);
						messageIndex.set(chunk.mid, message);
					}

					message.appendChunk(chunk);

					if (!message.isDone) {
						// Show different status based on chunk type and content
						if (chunk.data.type === 'status') {
							self.data.messageStatus = `💫 ${chunk.data.status}`;
						} else {
							// Otherwise we're writing content
							self.data.messageStatus = '💫 Writing ...';
						}
						self.data.message.disabled = true;
						self.data.submitButton.disabled = true;
					} else {
						self.data.messageStatus = '';
						self.data.submitButton.disabled = false;
						self.data.message.disabled = false;
						self.data.message.focus();
					}

					if (startedAtBottom) self.autoscroll();
				},
				onclose(reason) {
					if (reason !== 'unsubscribed') {
						self.data.status = 'Disconnected. (Refresh to try reconnecting.)';
					}
				}
			});
		}
	}))
	.onadd(async () => {
		// Load conversations first
		await self.loadConversations();
		
		// Set up event handlers
		self.data.conversationSelect.addEventListener('change', (e) => {
			const target = e.target as HTMLSelectElement;
			self.loadConversation(target.value);
		});
		
		self.data.newConversationBtn.addEventListener('click', () => {
			self.loadConversation(""); // Empty string = new conversation
		});
		
		self.data.deleteConversationBtn.addEventListener('click', () => {
			if (confirm('Are you sure you want to delete this conversation? This cannot be undone.')) {
				self.deleteCurrentConversation();
			}
		});
		
		// Start with new conversation
		self.data.message.value = '';
	});
	return self;
}

async function App() {
	return html`<div id='app'>
		${await AuthenticatedContent({
			authenticated: Chat,
			unauthenticated: () => html`<p>Sign in for the LLM demo.</p>`
		})}
	</div>`;
}

export async function generate() {
	return Main({
		pageTitle: 'LLM Demo',
		content: await App()
	})
}

hydrate('app', App as any);