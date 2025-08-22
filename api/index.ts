import { AuthenticationService, Endpoint } from 'wirejs-resources';
import { Chat } from './apps/chat.js';
import { Todos } from './apps/todos.js';
import { Wiki } from './apps/wiki.js';
import { Store } from './apps/store.js';
import { Admin } from './apps/admin.js';

export type * from './apps/todos.js';
export type * from './apps/store.js';
export type * from './apps/admin.js';

const authService = new AuthenticationService('app', 'core-users');

export const auth = authService.buildApi();
export const chat = Chat(auth);
export const todos = Todos(auth);
export const wiki = Wiki(auth);
export const store = Store(auth);
export const admin = Admin(auth);

new Endpoint('app', 'sample-endpoint', {
	description: "Sample endpoint to show programmatic endpoint creation.",
	handle(context) {
		context.responseHeaders['Content-Type'] = 'text/html; charset=utf-8';
		return "<html><body><p>Hello!</p><p><a href='/'>Back.</a></body></html>";
	}
});

new Endpoint('app', 'sample-wildcard-endpoint', {
	path: 'wildcard-endpoint/%',
	description: "Sample endpoint to show programmatic wildcard endpoint creation.",
	handle(context) {
		context.responseHeaders['Content-Type'] = 'text/html; charset=utf-8';
		return `<html>
			<body>
				<h2>${context.location.toString()
					.replace(/</, '&lt;')
					.replace(/>/, '&gt;')
				}</h2>
				<p><a href='/'>Back.</a>
			</body>
		</html>`;
	}
});
