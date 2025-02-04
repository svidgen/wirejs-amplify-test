import { AuthenticationService, FileService, withContext } from 'wirejs-resources';

const userTodos = new FileService('app', 'userTodoApp');
const wikiPages = new FileService('app', 'wikiPages');
const authService = new AuthenticationService('app', 'core-users');

export const auth = authService.buildApi();

export type Todo = {
	id: string;
	text: string;
};

export const todos = withContext(context => ({
	async read(): Promise<Todo[]> {
		const user = await auth.requireCurrentUser(context);

		try {
			const todos = await userTodos.read(`${user.id}/todos.json`);
			return todos ? JSON.parse(todos) : [];
		} catch (error) {
			return [];
		}
	},
	async write(todos: Todo[]) {
		const user = await auth.requireCurrentUser(context);

		if (!Array.isArray(todos) || !todos.every(todo =>
			typeof todo.id === 'string'
			&& typeof todo.text === 'string')
		) {
			throw new Error("Invalid todos!");
		}

		const finalTodos = todos.map(todo => ({ id: todo.id, text: todo.text }));
		await userTodos.write(`${user.id}/todos.json`, JSON.stringify(finalTodos));

		return true;
	}
}));

function normalizeWikiPageFilename(page: string) {
	return page.replace(/[^-_a-zA-Z0-9/]/g, '-') + '.md';
}

export const wiki = withContext(context => ({
	async read(page: string) {
		const filename = normalizeWikiPageFilename(page);
		try {
			return await wikiPages.read(filename);
		} catch (error) {
			return null;
		}
	},
	async write(page: string, content: string) {
		await auth.requireCurrentUser(context);

		const filename = normalizeWikiPageFilename(page);
		await wikiPages.write(filename, content);

		return true;
	}
}));