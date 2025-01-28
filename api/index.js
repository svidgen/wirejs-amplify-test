import { AuthenticationService, FileService, withContext } from 'wirejs-resources';
import { defaultGreeting } from '../src/lib/sample-lib.js';

const userTodos = new FileService('app', 'userTodoApp');
const wikiPages = new FileService('app', 'wikiPages');
const authService = new AuthenticationService('app', 'core-users');

export const auth = authService.buildApi();

async function currentUser(context) {
	const { user } = await authService.getBaseState(context.cookies);
	return user;
}

/**
* Given a name, this will return a friendly, personalized greeting.
* @param {string} name
* @returns {Promise<string>} A friendly greeting.
*/
export const hello = withContext(context => async (name) => {
	const user = await currentUser();
	return `${defaultGreeting()}, ${user ? `<b>${user}</b>` : '<i>Anonymous</i>'}.`;
});

export const todos = withContext(context => ({
	async read() {
		const user = await currentUser(context);

		console.log('current user', user);

		if (!user) {
			throw new Error("Unauthorized");
		}

		try {
			const todos = await userTodos.read(`${user}/todos.json`);
			return todos ? JSON.parse(todos) : [];
		} catch (error) {
			return [];
		}
	},
	/**
	 * @param {string[]} todos 
	 */
	async write(todos) {
		const user = await currentUser(context);

		if (!user) {
			throw new Error("Unauthorized");
		}

		if (!Array.isArray(todos)) {
			throw new Error("Invalid todos!");
		}

		if (!todos.every(todo =>
			typeof todo.id === 'string'
			&& typeof todo.text === 'string')
		) {
			throw new Error("Invalid todos!");
		}

		const finalTodos = todos.map(todo => ({ id: todo.id, text: todo.text }));
		await userTodos.write(`${user}/todos.json`, JSON.stringify(finalTodos));

		return true;
	}
}));

function normalizeWikiPageFilename(page) {
	return page.replace(/[^-_a-zA-Z0-9/]/g, '-') + '.md';
}

export const wiki = withContext(context => ({
	async read(page) {		
		const filename = normalizeWikiPageFilename(page);
		try {
			return await wikiPages.read(filename);
		} catch (error) {
			console.log("returning empty content");
			return undefined;
		}
	},
	/**
	 * @param {string[]} todos 
	 */
	async write(page, content) {
		const user = await currentUser(context);

		if (!user) {
			throw new Error("Unauthorized");
		}

		const filename = normalizeWikiPageFilename(page);
		await wikiPages.write(filename, content);

		return true;
	}
}));