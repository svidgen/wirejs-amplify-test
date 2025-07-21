import { html, hydrate, text } from 'wirejs-dom/v2';
import { Main } from '../layouts/main.js';
import { worker } from 'web-worker';

async function App() {
	return html`<div id='app'>
		<h4>Web Worker Demo</h4>
		<div>${text('status', '...')}</div>
		<div>Web Worker output: ${text('output', '...')}</div>
	</div>`.onadd(async self => {
		console.log('starting web worker');
		self.data.output = (await worker.count(256_000_000, {
			tick: pct => self.data.status = `${Math.floor(pct * 100)} % complete.`
		})).toString();
	});
}

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: await App()
	})
}

hydrate('app', App as any);