import {
	AuthenticationApi,
	DistributedTable,
	PassThruParser,
	withContext
} from 'wirejs-resources';

export type Todo = {
	id: string;
	text: string;
	order: number;
	list: string;
};


const userTodos = new DistributedTable('app', 'userTodos', {
	parse: PassThruParser<Todo & { userId: string }>,
	key: {
		partition: { field: 'userId', type: 'string' },
		sort: { field: 'id', type: 'string' }
	},
	indexes: [
		{
			partition: { field: 'userId', type: 'string' },
			sort: { field: 'list', type: 'string' },
		}
	]
});

export const Todos = (auth: AuthenticationApi) => withContext(context => ({
	async read(list?: string): Promise<Todo[]> {
		const user = await auth.requireCurrentUser(context);

		try {
			const todos = userTodos.query({
				by: 'userId-list',
				where: {
					userId: { eq: user.id },
					list: { eq: list ?? 'default' }
				},
			});
			const todosArray = await fromAsync(todos);
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

/**
 * For node 20, which doesn't have `Array.fromAsync()`.
 */
async function fromAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of gen) {
		items.push(item);
	}
	return items;
}