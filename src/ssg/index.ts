import { html } from 'wirejs-dom/v2';
import { Main } from '../layouts/main.js';

export async function generate() {
	return Main({
		pageTitle: 'Welcome!',
		content: html`<div>
			<p>This is your wirejs app!</p>
			<p>It comes with some sample API methods and pages.</p>
			<ul>
				<li><a href='/todo-app.html'>Todo App</a></li>
				<li><a href='/simple-wiki/index.html'>Simple Wiki</a></li>
			</ul>
		</div>`
	})
}
