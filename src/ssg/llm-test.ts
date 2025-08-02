import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, css, attribute, hydrate, list, text, node } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { llm, LLMMessage } from 'internal-api';

const sheet = css`
	.messages {
		height: calc(100vh - 30rem);
		overflow: scroll;
	}
`;

function formatMessage(message: string): string {
	return DOMPurify.sanitize(marked.parse(message) as string);
}

async function Chat() {
	const self = html`<div id='chat'>
		${sheet}
		<!-- All messages. Markdown formatted. Sanitized. -->
		<div ${id('messageContainer', HTMLDivElement)} class='messages'>
			${list('messages', (m: Exclude<LLMMessage, string>) =>
				html`<div>
					<b>${m.role}</b><br />
					${formatMessage(m.content)}
				</div>`
			)}
			${node('pendingMessage', (md) => md ? html`<div style='color: #333;'>
				<b>assistant</b><br />
				${formatMessage(md || '')}
			</div>` : html`<div></div>`)}
		</div>

		<!-- New message form -->
		<form ${id('messageForm', HTMLFormElement)}
			onsubmit=${async (event: Event) => {
				event.preventDefault();
				if (!self.activeRoom) {
					self.data.messages.push({
						role: 'system',
						content: "Not connected!"
					});
					return;
				}
				self.data.messages.push({
					role: 'user',
					content: self.data.message.value.trim()
				});
				self.data.message.value = '';
				self.data.message.disabled = true;
				self.data.submitButton.disabled = true;
				self.data.message.style.height = 'auto';
				self.autoscroll();
				await llm.send(null, self.activeRoom, self.data.messages);
			}}
		><textarea
				${id('message', HTMLTextAreaElement)}
				autocomplete="on"
				autocorrect="on"
				autocapitalize="on"
				type='text'
				style="
					width: calc(100% - 5rem);
					height: 1.5em;
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
				type='submit' value='&gt;' style='width: 2em;' />
		</form>

		<!-- Connection status -->
		<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>

	</div>`.extend(() => ({
		activeRoom: undefined as string | undefined,
		autoscroll() {
			self.data.messageContainer.scrollTop = 
				self.data.messageContainer.scrollHeight;
		},
		disconnect() {
			// no implementation until connected
		},
		async connect() {
			self.activeRoom = await llm.createRoom(null);
			const roomStream = await llm.getRoom(null, self.activeRoom);
			self.disconnect = roomStream.subscribe({
				onopen() {
					self.data.status = `Connected to "${self.activeRoom}".`;
				},
				onmessage(message) {
					if (message === '**start**') {
						self.data.pendingMessage = '';
						self.data.message.disabled = true;
						self.data.submitButton.disabled = true;
					} else if (message === '**end**') {
						console.log('Message ended:', self.data.pendingMessage);
						self.data.messages.push({
							role: 'assistant',
							content: self.data.pendingMessage
						});
						self.data.pendingMessage = '';
						self.data.message.disabled = false;
						self.data.submitButton.disabled = false;
					} else {
						self.data.pendingMessage += message.content;
					}
					self.autoscroll();
				},
				onclose(reason) {
					if (reason !== 'unsubscribed') {
						self.data.status = 'Disconnected. (Refresh the page to reconnect.)';
					}
				}
			});
		}
	}))
	.onadd(async () => {
		self.connect();
	});
	return self;
}

async function App() {
	return html`<div id='app'>
		<h4>Realtime Demo</h4>
		${await AuthenticatedContent({
			authenticated: Chat,
			unauthenticated: () => html`<p>Sign in for the realtime demo.</p>`
		})}
	</div>`;
}

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: await App()
	})
}

hydrate('app', App as any);