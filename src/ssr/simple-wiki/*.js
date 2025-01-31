import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, text, hydrate, node, list, attribute } from 'wirejs-dom/v2';
import { accountMenu } from '../../components/account-menu.js';
import { auth, wiki } from 'my-api';

/**
 * @template T
 * @typedef {T extends object ? {
 * 	[K in keyof T]: T[K] extends HTMLElement | Element | Node
 * 		? { data: NonHtml<T[K]['data']> }
 * 		: NonHtml<T[K]>
 * } : T} NonHtml
 */

/**
 * @template T extends HTMLElement & { data: any }
 * 
 * Shallow check for a `data` hydration property. If present, returns the
 * argument typed according to the given `T`.
 * 
 * @param {unknown} arg0
 * @returns {NonHtml<T['data']> | undefined}
 */
function initData(arg0) {
	return arg0?.data ? data : undefined;
}

/**
 * @param {{
 * 	content: string | undefined;
 * 	user: string | undefined;
 * }}
 * @returns 
 */
async function Wiki(init) {
	const { context } = init;

	const data = /** @type {ReturnType<typeof initData<typeof self>>} */ (init?.data);

	console.log('Wiki init', init);
	const filepath = (context || window).location.pathname;

	/** @type {string} */
	const content = data?.content || await wiki.read(context, filepath);

	/** @type {Awaited<ReturnType<typeof auth.getState>>} */
	const initialState = data?.initialAuthState || await auth.getState(context);

	const accountMenuNode = accountMenu({ api: auth, initialState });

	let markdown = content ?? `This page doesn't exist yet`;
	const signedOutAction = html`<i>(<b>Sign in</b> to edit.)</i>`;
	const signedInAction = html`<button onclick=${enableEditing}>edit</button>`;
	const invisibleDiv = html`<div style='display: none;'></div>`;
	const editor = html`<div>
		<textarea style='width: 20em; height: 10em;' ${id('textarea')}></textarea>
	</div>`;

	accountMenuNode.data.onchange(state => {
		self.data.actions = actionsFor(state);
	});

	/**
	 * @param {Awaited<ReturnType<typeof auth.getState>} state 
	 */
	function actionsFor(state) {
		return state.state.state === 'authenticated' ? signedInAction : signedOutAction;
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
			html`<div>${DOMPurify.sanitize(marked.parse(md))}</div>`)
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