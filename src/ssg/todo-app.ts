import { html, node, list, attribute, hydrate } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
// import { auth, todos, Todo } from 'my-api';
import { Main } from '../layouts/main.js';

function Todos() {
	// const remove = (todo: Todo) => {
	// 	self.data.todos = self.data.todos.filter(t => t.id !== todo.id);
	// 	todos.remove(null, todo.id);
	// }

	// const newid = () => crypto.randomUUID();
	
	// const self = html`<div>
	// 	<h4>Your Todos</h4>
	// 	<ol>${list('todos', (todo: Todo) => html`<li>
	// 		${todo.text} : <span
	// 			style='color: darkred; font-weight: bold; cursor: pointer;'
	// 			onclick=${() => remove(todo)}
	// 		>X</span>
	// 	</li>`)}</ol>
	// 	<div>
	// 		<form onsubmit=${(event: Event) => {
	// 			event.preventDefault();
	// 			const todo = {
	// 				id: newid(),
	// 				list: 'default',
	// 				text: self.data.newTodoText,
	// 				order: (self.data.todos[
	// 					self.data.todos.length - 1
	// 				]?.order ?? 0) + 1,
	// 			};
	// 			self.data.todos.push(todo);
	// 			self.data.newTodoText = '';
	// 			todos.save(null, todo).catch((e: any) => alert(e.message));
	// 		}}>
	// 			<input type='text' value=${attribute('newTodoText', '' as string)} />
	// 			<input type='submit' value='Add' />
	// 		</form>
	// 	</div>
	// <div>`.onadd(async self => {
	// 	self.data.todos = await todos.read(null, 'default');
	// });
	// return self;
	return html`<div id='todos'>Upgrading ... be right back.</div>`;
}

async function App() {
	const self = html`<div id='app'>
		${await AuthenticatedContent({
			authenticated: () => Todos(),
			unauthenticated: () => html`<div>
				You need to sign in to add your todo list.
			</div>`
		})}
	</div>`;

	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Todo App',
		content: await App(),
	});
}

hydrate('app', App as any);
