import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, text, hydrate, node, list, attribute } from 'wirejs-dom/v2';
import { accountMenu } from '../../components/account-menu.js';
import { auth, wiki } from 'my-api';

/**
 * @param {{
 * 	content: string | undefined;
 * 	user: string | undefined;
 * }}
 * @returns 
 */
async function Wiki({ context }) {
	const filepath = (context || window).location.pathname;
	const content = await wiki.read(context, filepath);

	const accountMenuNode = accountMenu(auth);
	let markdown = content ?? `This page doesn't exist yet`;
	const signedOutAction = html`<i>(<b>Sign in</b> to edit.)</i>`;
	const signedInAction = html`<button onclick=${enableEditing}>edit</button>`;
	const invisibleDiv = html`<div style='display: none;'></div>`;
	const editor = html`<div>
		<textarea style='width: 20em; height: 10em;' ${id('textarea')}></textarea>
	</div>`;

	accountMenuNode.data.onchange(async state => {
		if (state.state.user) {
			self.data.actions = signedInAction;
		} else {
			self.data.actions = signedOutAction;
		}
	});

	function enableEditing() {
		editor.data.textarea.value = markdown;
		self.data.editor = editor;
		self.data.actions = html`<div>
			<button onclick=${submitChanges}>save</button>
			<button onclick=${cancelChanges}>cancel</button>
		</div>`;
	}

	async function submitChanges() {
		markdown = editor.data.textarea.value;
		await wiki.write(context, filepath, markdown);
		self.data.content = markdown;
		self.data.actions = signedInAction;
		self.data.editor = invisibleDiv;
	}

	function cancelChanges() {
		self.data.actions = signedInAction;
		self.data.editor = html`<div style='display: none;'></div>`;
		self.data.content = markdown;
	}

	const self = html`<div id='wiki'>
		<div style='float: right;'>${accountMenuNode}</div>
		${node('content', markdown, md => 
			html`<div>${DOMPurify.sanitize(marked.parse(md))}</div>`)
		}
		${node('editor', invisibleDiv)}
		${node('actions', signedOutAction)}
	</div>`;

	return self;
}

/**
 * 
 * @param {import('wirejs-services').Context} context 
 * @returns 
 */
export async function generate(context) {
	const visiblePath = context.location.pathname
		.replaceAll('/', ' > ')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('-', ' ')
		.replace(/\s+/g, ' ')
	;

	const page = html`
		<!doctype html>
		<html>
			<head>
				<title>Wiki ${visiblePath}</title>
			</head>
			<body>
				<p><a href='/'>Home</a></p>
				<h1>Wiki ${visiblePath}</h1>
				${await Wiki({ context })}
			</body>
		</html>
	`;

	return page;
}

hydrate('wiki', Wiki);