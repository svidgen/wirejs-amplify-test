import { html, hydrate } from 'wirejs-dom/v2';

async function App() {
	return html`<div id='app'>
	</div>`;
}

export async function generate() {
	const page = html`
		<!doctype html>
		<html>
			<head>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Welcome!</title>
			</head>
			<body>
				<h1>Welcome!</h1>
				<p>This is your wirejs app!</p>
				<p>It comes with some sample API methods and pages.</p>
				<ul>
					<li><a href='/todo-app.html'>Todo App</a></li>
					<li><a href='/simple-wiki/index.html'>Simple Wiki</a></li>
				</ul>
			</body>
		</html>
	`;
	return page;
}
