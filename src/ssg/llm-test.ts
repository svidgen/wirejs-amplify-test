import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, attribute, hydrate, list, text, id } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { llm } from 'my-api';

const ROOM_NAME = 'llm-demo-room';

async function Chat() {
	const self = html`<div id='chat'>
		<!-- All messages. Markdown formatted. Sanitized. -->
		${list('messages', message =>
			html`${DOMPurify.sanitize((marked.parse(message) as string))}`
		)}

		<!-- New message form -->
		<form onsubmit=${(event: Event) => {
			event.preventDefault();
			llm.send(null, ROOM_NAME, self.data.message);
			self.data.message = '';
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
					self.data.messages.push(message);
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