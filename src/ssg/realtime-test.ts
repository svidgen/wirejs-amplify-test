import { html, attribute, hydrate, list } from 'wirejs-dom/v2';
import { Main } from '../layouts/main.js';
import { messaging } from 'my-api';

async function App() {
	const self = html`<div id='app'>
		<h4>Realtime Test</h4>
		${list('messages', (message: string) => html`<div>${message}</div>`)}
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
	</div>`.onadd(async () => {
		const roomStream = await messaging.getRoom(null, 'test');
		roomStream.subscribe({
			onmessage: (message: string) => {
				self.data.messages.push(message);
			}
		});
	})
	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: await App()
	})
}

hydrate('app', App);