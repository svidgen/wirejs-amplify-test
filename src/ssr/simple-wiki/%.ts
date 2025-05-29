import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { html, id, hydrate, node, } from 'wirejs-dom/v2';
import type { AuthenticationMachineState, Context } from 'wirejs-resources';
// import { auth, wiki } from 'my-api';
import { AuthMonitor } from 'wirejs-components/utils';
import { Main } from '../../layouts/main.js';


async function Wiki(init: { context?: Context, data?: any }) {
	// const { context, data } = init;

	// const filepath = (context || window).location.pathname;

	// const content: string =
	// 	data?.content ?? await wiki.read(context, filepath);

	// const initialState: AuthenticationMachineState =
	// 	data?.initialAuthState ?? await auth.getState(context);

	// let markdown: string = content ?? `This page doesn't exist yet`;
	// const signedOutAction = html`<i>(<b>Sign in</b> to edit.)</i>`;
	// const signedInAction = html`<button onclick=${enableEditing}>edit</button>`;
	// const invisibleDiv = html`<div style='display: none;'></div>`;
	// const editor = html`<div>
	// 	<textarea
	// 		${id('textarea', HTMLTextAreaElement)}
	// 	></textarea>
	// </div>`;

	// AuthMonitor.subscribe(state => {
	// 	self.data.actions = actionsFor(state);
	// });

	// function actionsFor(state: AuthenticationMachineState | undefined) {
	// 	return state?.state === 'authenticated' ? signedInAction : signedOutAction;
	// }

	// function enableEditing() {
	// 	editor.data.textarea.value = markdown;
	// 	self.data.editor = editor;
	// 	self.data.actions = html`<div>
	// 		<button onclick=${submitChanges}>save</button>
	// 		<button onclick=${cancelChanges}>cancel</button>
	// 	</div>`;
	// }

	// async function submitChanges() {
	// 	markdown = editor.data.textarea.value;
	// 	await wiki.write(context, filepath, markdown);
	// 	self.data.content = markdown;
	// 	self.data.actions = signedInAction;
	// 	self.data.editor = invisibleDiv;
	// }

	// function cancelChanges() {
	// 	self.data.actions = signedInAction;
	// 	self.data.editor = html`<div style='display: none;'></div>`;
	// 	self.data.content = markdown;
	// }

	// const self = html`<div id='wiki'>
	// 	${node('content', markdown, md => 
	// 		html`<div>${DOMPurify.sanitize(marked.parse(md!) as string)}</div>`)
	// 	}
	// 	${node('editor', invisibleDiv)}
	// 	${node('actions', actionsFor(initialState))}
	// </div>`.extend(_ => ({
	// 	data: {
	// 		initialAuthState: initialState
	// 	}
	// }));

	// return self;

	return html`<div id='wiki'>Upgrading ... We'll be right back.</div>`;
}

export async function generate(context: Context) {
	const visiblePath = context.location.pathname
		.replaceAll('/', ' > ')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('-', ' ')
		.replace(/\s+/g, ' ')
	;

	return Main({
		siteSubTitle: 'A simple sample wiki',
		pageTitle: visiblePath,
		content: await Wiki({ context }),
	})
}

hydrate('wiki', Wiki);
