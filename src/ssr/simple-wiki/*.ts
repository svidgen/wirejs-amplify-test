import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, text, hydrate, node, list, attribute, KindaPretty } from 'wirejs-dom/v2';
import type { AuthenticationMachineState, Context } from 'wirejs-resources';
import { accountMenu } from '../../components/account-menu.js';
import { auth, wiki } from 'my-api';

type WithoutNodes<T> = KindaPretty<{
	[K in keyof T]: T[K] extends Node
		? T[K] extends { data: any } ? WithoutNodes<T[K]['data']> : undefined
		: WithoutNodes<T[K]>
}>

/**
 * Shallow check for a `data` hydration property. If present, returns the
 * argument typed according to the given `T`.
 */
function initData<T extends { data: any }>(arg0: any): WithoutNodes<T['data']> | undefined {
	return arg0?.data ? arg0.data : undefined;
}

async function Wiki(init: { context?: Context, data?: any }) {
	const { context } = init;

	const data = initData<typeof self>(init);

	console.log('Wiki init', init);
	const filepath = (context || window).location.pathname;

	const content = data?.content || await wiki.read(context, filepath);
	const initialState: AuthenticationMachineState =
		data?.initialAuthState || await auth.getState(context)
	;
	const accountMenuNode = accountMenu({ api: auth, initialState });

	let markdown: string = content ?? `This page doesn't exist yet`;
	const signedOutAction = html`<i>(<b>Sign in</b> to edit.)</i>`;
	const signedInAction = html`<button onclick=${enableEditing}>edit</button>`;
	const invisibleDiv = html`<div style='display: none;'></div>`;
	const editor = html`<div>
		<textarea
			${id('textarea', HTMLTextAreaElement)}
			style='width: 20em; height: 10em;'
		></textarea>
	</div>`;

	accountMenuNode.data.onchange(state => {
		self.data.actions = actionsFor(state);
	});

	function actionsFor(state: AuthenticationMachineState) {
		return state.state === 'authenticated' ? signedInAction : signedOutAction;
	}

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
			html`<div>${DOMPurify.sanitize(marked.parse(md!) as string)}</div>`)
		}
		${node('editor', invisibleDiv)}
		${node('actions', actionsFor(initialState))}
	</div>`.extend(self => ({
		data: {
			initialAuthState: initialState
		}
	}));

	return self;
}

export async function generate(context: Context) {
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
				<meta name="viewport" content="width=device-width, initial-scale=1" />
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
