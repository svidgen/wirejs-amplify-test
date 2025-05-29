import { html, attribute, hydrate, list, text } from 'wirejs-dom/v2';
import { Main } from '../layouts/main.js';
// import { messaging } from 'my-api';

async function App() {
	// const self = html`<div id='app'>
	// 	<h4>Realtime Test</h4>
	// 	${list('messages', (message: string) => html`<div>${message}</div>`)}
	// 	<div>
	// 		<form onsubmit=${(event: Event) => {
	// 			event.preventDefault();
	// 			messaging.publish(null, 'test', self.data.message);
	// 			self.data.message = '';
	// 		}}>
	// 			<input type='text' value=${attribute('message', '' as string)} />
	// 			<input type='submit' value='Send' />
	// 		</form>
	// 	</div>
	// 	<span style='color: var(--color-muted)'>${text('status', 'Connecting ...')}</span>
	// </div>`.onadd(async () => {
	// 	const roomStream = await messaging.getRoom(null, 'test');
	// 	roomStream.subscribe({
	// 		onopen() {
	// 			self.data.status = 'Connected';
	// 		},
	// 		onmessage(message: string) {
	// 			self.data.messages.push(message);
	// 		},
	// 		onclose() {
	// 			self.data.status = 'Disconnected. (Refresh the page to reconnect.)';
	// 		}
	// 	});
	// })
	// return self;
	return html`<div id='app'>Upgrading ... be right back.</div>`;
}

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: await App()
	})
}

hydrate('app', App);