import { html, list, attribute, hydrate } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { mailer } from 'internal-api';
import { Main } from '../layouts/main.js';

function Email() {
	const send = async (subject: string, body: string) => {
		try {
			await mailer.sendTestMessage(undefined, subject, body);
			alert("Message sent!");
		} catch {
			alert("Send failed.");
		}
	}
	
	const self = html`<div>
		<h4>Email test</h4>
		<div>
			<form onsubmit=${(event: Event) => {
				event.preventDefault();
				const subject = self.data.subject;
				const body = self.data.body;
				self.data.subject = '';
				self.data.body = '';
				send(subject, body);
			}}>
				<p>Subject: <input type='text' value=${attribute('subject', '' as string)} /></p>
				<p>Body: <input type='text' value=${attribute('body', '' as string)} /></p>
				<input type='submit' value='Send' />
			</form>
		</div>
	<div>`;

	return self;
}

async function App() {
	const self = html`<div id='app'>
		${await AuthenticatedContent({
			authenticated: () => Email(),
			unauthenticated: () => html`<div>
				You need to sign in to send a message.
			</div>`
		})}
	</div>`;

	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Emailer Test',
		content: await App(),
	});
}

hydrate('app', App as any);
