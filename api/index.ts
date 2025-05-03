import {
	AuthenticationService,
	DistributedTable,
	FileService,
	PassThruParser,
	withContext
} from 'wirejs-resources';

const userTodos = new DistributedTable('app', 'userTodos', {
	parse: PassThruParser<Todo & { userId: string }>,
	key: {
		partition: { field: 'userId', type: 'string' },
		sort: { field: 'id', type: 'string' }
	},
	// indexes: [
	// 	{
	// 		partition: { field: 'userId', type: 'string' },
	// 		sort: { field: 'list', type: 'string' },
	// 	}
	// ]
});

const wikiPages = new FileService('app', 'wikiPages');
const authService = new AuthenticationService('app', 'core-users');

export const auth = authService.buildApi();

export type Todo = {
	id: string;
	text: string;
	order: number;
	list: string;
};

export const todos = withContext(context => ({
	async read(list?: string): Promise<Todo[]> {
		const user = await auth.requireCurrentUser(context);

		try {
			const todos = userTodos.query({
				by: 'userId-id',
				where: {
					userId: { eq: user.id }
				}
				// by: 'userId-list',
				// where: {
				// 	userId: { eq: user.id },
				// 	list: { eq: list ?? 'default' }
				// },
			});
			const todosArray = await Array.fromAsync(todos);
			return todosArray
				.sort((a, b) => a.order - b.order)
				.map(todo => ({
					id: todo.id,
					text: todo.text,
					order: todo.order,
					list: todo.list || 'default'
				}));
		} catch (error) {
			return [];
		}
	},

	async save(todo: Todo) {
		const user = await auth.requireCurrentUser(context);

		if (typeof todo.id !== 'string' || typeof todo.text !== 'string') {
			throw new Error("Invalid todo!");
		}

		const finalTodo = {
			userId: user.id,
			id: todo.id,
			text: todo.text,
			order: todo.order,
			list: todo.list || 'default'
		};
		await userTodos.save(finalTodo);

		return true;
	},

	async remove(todoId: string) {
		const user = await auth.requireCurrentUser(context);

		if (typeof todoId !== 'string') {
			throw new Error("Invalid todo ID!");
		}

		await userTodos.delete({ userId: user.id, id: todoId });

		return true;
	},
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