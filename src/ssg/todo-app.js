import { html, node, list, attribute, hydrate } from 'wirejs-dom/v2';
import { accountMenu } from '../components/account-menu.js';
import { auth, todos } from 'my-api';

function Todos() {
	const save = async () => {
		try {
			await todos.write(true, self.data.todos);
		} catch (error) {
			alert(error);
		}
	}

	const remove = todo => {
		self.data.todos = self.data.todos.filter(t => t.id !== todo.id);
		save();
	}

	const newid = () => crypto.randomUUID();
	
	const self = html`<div>
		<h4>Your Todos</h4>
		<ol>${list('todos', todo => html`<li>
			${todo.text} : <span
				style='color: darkred; font-weight: bold; cursor: pointer;'
				onclick=${() => remove(todo)}
			>X</span>
		</li>`)}</ol>
		<div>
			<form onsubmit=${event => {
				event.preventDefault();
				self.data.todos.push({ id: newid(), text: self.data.newTodo });
				self.data.newTodo = '';
				save();
			}}>
				<input type='text' value=${attribute('newTodo', '')} />
				<input type='submit' value='Add' />
			</form>
		</div>
	<div>`.onadd(async self => {
		self.data.todos = await todos.read(true);
	});
	return self;
}

async function App() {
	const accountMenuNode = accountMenu(auth);

	accountMenuNode.data.onchange(async state => {
		if (state.state.user) {
			self.data.content = Todos();
		} else {
			self.data.content = html`<div>You need to sign in to add your todo list.</div>`;
		}
	});

	const self = html`<div id='app'>
		<div style='float: right;'>${accountMenuNode}</div>
		${node('content', html`<div>Loading ...</div>`)}
	</div>`;

	return self;
}

export async function generate() {
	const page = html`
		<!doctype html>
		<html>
			<head>
				<title>Todo App</title>
			</head>
			<body>
				<p><a href='/'>Home</a></p>
				<h1>Todo App</h1>
				${await App()}
			</body>
		</html>
	`;

	return page;
}

hydrate('app', App);
