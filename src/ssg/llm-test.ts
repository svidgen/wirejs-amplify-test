import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, css, hydrate, list, text, node } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { llm, Chunk } from 'internal-api';

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
	const cleanedMessage = message.replace(/<tool-result>[\s\S]*?<\/tool-result>/g, '');
	
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
			if (typeof c.data !== 'string') {
				md.push(c.data.text);
			}
		}

		const newContent = md.join('');
		this.originalContent = newContent;
		this.view.data.body = formatMessage(newContent);

		if (chunk.data === '**start**') {
			this.isDone = false;
		} else if (chunk.data === '**end**') {
			this.isDone = true;
		} else if (chunk.data === '**tool-processing**') {
			// Keep the message in processing state during tool calls
			this.isDone = false;
		}
	}
}

async function Chat() {
	const messageIndex = new Map<number, Message>();

	const self = html`<div id='chat'>
		${sheet}

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
					self.data.status = "<b>Not connected!</b>";
					return;
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
				llm.send(null, self.activeRoom, userMessage).catch(error => {
					console.error(error);
					self.data.status = '<b>Error. Try again.</b>';
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
		<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>

	</div>`.extend(() => ({
		activeRoom: undefined as string | undefined,
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
			// no implementation until connected
		},
		async connect() {
			self.activeRoom = await llm.createRoom(null);
			
			// For new rooms, don't load history since there shouldn't be any
			// History loading would be useful for reconnecting to existing conversations
			
			const roomStream = await llm.getRoom(null, self.activeRoom);
			let isThinking = false;
			self.disconnect = roomStream.subscribe({
				onopen() {
					self.data.status = `Connected.`;
				},
				onmessage(chunk) {
					const startedAtBottom = self.isScrolledDownWithinMargin(50);
					
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
						isThinking = true;
						// Show different status based on chunk type
						if (chunk.data === '**tool-processing**') {
							self.data.messageStatus = '💫 Waiting for external resources ...';
						} else if (chunk.data === '**start**') {
							self.data.messageStatus = '💫 Thinking ...';
						} else {
							self.data.messageStatus = '💫 Writing ...';
						}
						self.data.message.disabled = true;
						self.data.submitButton.disabled = true;
					} else {
						isThinking = false;
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
		self.connect();
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