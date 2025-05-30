import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, attribute, hydrate, list, text, id } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { chat } from 'my-api';

type RoomMessage = {
	username: string;
	body: string;
};

async function Chat() {
	const self = html`<div id='chat'>
		<!-- All messages. Markdown formatted. Sanitized. -->
		${list('messages', (message: RoomMessage) =>
			html`${DOMPurify.sanitize((
				marked.parse(`**${message.username}:** ${message.body}`
			) as string))}`)}

		<!-- Input for new messages. -->
		<form onsubmit=${(event: Event) => {
			event.preventDefault();
			chat.publish(null, self.data.room, self.data.message);
			self.data.message = '';
		}}>
			<input type='text' value=${attribute('message', '' as string)} />
			<input type='submit' value='Send' />
		</form>

		<!-- Connection status -->
		<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>

		<!-- Room selection -->
		<form ${id('roomChangeForm')} onsubmit=${(event: Event) => {
			event.preventDefault();
			self.data.messages = [];
			self.disconnect();
			self.data.status = `Connecting to "${self.data.room}" ...`;
			self.connect();
		}}>Join another room:
			<input type='text' style='width: 10rem;'
				value=${attribute('room', 'test' as string)} />
			<input type='submit' style='width: 10rem;' value='Join' />
			<input type='button' style='width: 10rem;' value='Random' onclick=${() => {
				const randomRoom = Math.random().toString(36).substring(2, 10);
				self.data.room = randomRoom;
				self.data.roomChangeForm.dispatchEvent(new Event('submit'));
				// self.data.messages = [];
				// self.disconnect();
				// self.data.status = `Connecting to "${self.data.room}" ...`;
				// self.connect();
			}} />
		</form>

		<!-- Description -->
		<p>A simple example of realtime messaging. Messages are 100% ephemeral. If you reload the page, messages are lost. If you're not connected when a message it sent, you won't receive it.</p>
	</div>`.extend(() => ({
		disconnect() {
			// no implementation until connected
		},
		async connect() {
			const roomStream = await chat.getRoom(null, self.data.room);
			self.disconnect = roomStream.subscribe({
				onopen() {
					self.data.status = `Connected to "${self.data.room}".`;
				},
				onmessage(message) {
					self.data.messages.push(message);
				},
				onclose() {
					self.data.status = 'Disconnected. (Refresh the page to reconnect.)';
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