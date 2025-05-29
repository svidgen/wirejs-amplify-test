import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, attribute, hydrate, list, text } from 'wirejs-dom/v2';
import { Main } from '../layouts/main.js';
import { messaging } from 'my-api';

type RoomMessage = {
	username: string;
	message: string;
};

async function App() {
	const self = html`<div id='app'>
		<h4>Realtime Test</h4>
		${list('messages', (message: RoomMessage) =>
			html`${DOMPurify.sanitize((
				marked.parse(`**${message.username}:** ${message.message}`
			) as string))}`)}
		<div>
			<form onsubmit=${(event: Event) => {
				event.preventDefault();
				messaging.publish(null, 'test', self.data.message);
				self.data.message = '';
			}}>
				<input type='text' value=${attribute('message', '' as string)} />
				<input type='submit' value='Send' />
			</form>
		</div>
		<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>
	</div>`.onadd(async () => {
		const roomStream = await messaging.getRoom(null, 'test');
		roomStream.subscribe({
			onopen() {
				self.data.status = 'Connected';
			},
			onmessage(message) {
				self.data.messages.push(message);
			},
			onclose() {
				self.data.status = 'Disconnected. (Refresh the page to reconnect.)';
			}
		});
	});
	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: await App()
	})
}

hydrate('app', App);