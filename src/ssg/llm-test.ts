import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, css, attribute, hydrate, list, text, node } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { llm, LLMMessage } from 'my-api';

const ROOM_NAME = 'llm-demo-room';

const sheet = css`
	.messages {
		height: calc(100vh - 30rem);
		overflow: scroll;
	}
`;

async function Chat() {
	const self = html`<div id='chat'>
		${sheet}
		<!-- All messages. Markdown formatted. Sanitized. -->
		<div ${id('messageContainer')} class='messages'>
			${list('messages', (m: Exclude<LLMMessage, string>) =>
				html`<div>
					<b>${m.role}</b><br />
					${DOMPurify.sanitize((marked.parse(m.content) as string))}
				</div>`
			)}
			${node('pendingMessage', (md) => md ? html`<div style='color: #333;'>
				<b>assistant</b><br />
				${DOMPurify.sanitize((marked.parse(md || '') as string))}
			</div>` : html`<div></div>`)}
		</div>

		<!-- New message form -->
		<form onsubmit=${async (event: Event) => {
			event.preventDefault();
			self.data.messages.push({
				role: 'user',
				content: self.data.message.trim()
			});
			self.data.message = '';
			await llm.send(null, ROOM_NAME, self.data.messages);
		}}>
			<input type='text' value=${attribute('message', '' as string)} />
			<input type='submit' value='Send' />
		</form>

		<!-- Connection status -->
		<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>

	</div>`.extend(() => ({
		disconnect() {
			// no implementation until connected
		},
		async connect() {
			const roomStream = await llm.getRoom(null, ROOM_NAME);
			self.disconnect = roomStream.subscribe({
				onopen() {
					self.data.status = `Connected to "${ROOM_NAME}".`;
				},
				onmessage(message) {
					if (message === '**start**') {
						self.data.pendingMessage = '';
					} else if (message === '**end**') {
						console.log('Message ended:', self.data.pendingMessage);
						self.data.messages.push({
							role: 'assistant',
							content: self.data.pendingMessage
						});
						self.data.pendingMessage = '';
					} else {
						self.data.pendingMessage += message.content;
					}
					// @ts-ignore
					self.data.messageContainer.scrollTop = self.data.messageContainer.scrollHeight;
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