import { html, list, node, text, hydrate } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { Main } from '../layouts/main.js';
import { admin, Endpoint, Setting, SystemAttribute } from 'internal-api';

function SettingInput(setting: Setting, dirtySettings: Map<string, string>) {
	if (setting.isPrivate) {
		return html`<input
			type="password"
			value="${setting.value || ''}"
			oninput=${(event: Event) => dirtySettings.set(
				setting.key, (event.target as any).value
			)}
		/>`;
	}

	if (setting.options) {
		return html`<select
			oninput=${(event: Event) => dirtySettings.set(
				setting.key, (event.target as any).value
			)}>${setting.options.map(option =>
			html`<option
				value=${option}
				${setting.value === option ? 'selected' : ''}
			>${option}</option>`)
		}</select>`;
	}

	return html`<input
		type="text"
		value="${setting.value || ''}"
		oninput=${(event: Event) => dirtySettings.set(
			setting.key, (event.target as any).value
		)}
	/>`;
}

function Admin() {
	const dirtySettings = new Map<string, string>();

	const styledLink = (endpoint: Endpoint) => {
		const origin = endpoint.url.slice(0, endpoint.path.length);
		return html`<span>
			<a
				href='${endpoint.path}'
				style='font-weight: normal; color: gray;'
			>${origin}<b style='color: black;'>${endpoint.path}</b></a>
			
		</span>`;
	}

	const copyLinkButton = (endpoint: Endpoint) => {
		const COPY_ICON = "📋";
		const COPIED_ICON = "✅";
		const self = html`<span
				style="cursor: pointer; margin-left: 0.5em; font-size: smaller;"
				title="Copy to clipboard"
				onclick=${() => {
					navigator.clipboard.writeText(endpoint.url);
					self.data.status = COPIED_ICON;
					setTimeout(() => self.data.status = COPY_ICON, 1500);
				}}
			>${text('status', COPY_ICON)}
		</span>`;
		return self;
	}

	const copyValueButton = (value: string) => {
		const COPY_ICON = "📋";
		const COPIED_ICON = "✅";
		const self = html`<span
				style="cursor: pointer; margin-left: 0.5em; font-size: smaller;"
				title="Copy to clipboard"
				onclick=${() => {
					navigator.clipboard.writeText(value);
					self.data.status = COPIED_ICON;
					setTimeout(() => self.data.status = COPY_ICON, 1500);
				}}
			>${text('status', COPY_ICON)}
		</span>`;
		return self;
	}

	const load = async () => {
		self.data.settings = (await admin.listSettings(null))
			.sort((a, b) => a.key > b.key ? 1 : -1);
		self.data.endpoints = (await admin.listEndpoints(null))
			.sort((a, b) => a.id > b.id ? 1 : -1);
		self.data.attributes = (await admin.listSystemAttributes(null))
			.sort((a, b) => a.name > b.name ? 1 : -1);
	};

	const self = html`<div>
		<h3>Endpoints</h3>
		<table>
			${list('endpoints', (endpoint: Endpoint) => html`<tr>
				<td>
					<b>${endpoint.id}</b>
					<br /><span style='opacity: 0.75'>${endpoint.description}</span>
				</td>
				<td>&rarr;</td>
				<td>${styledLink(endpoint)}</td>
				<td>${copyLinkButton(endpoint)}</td>
			</tr>`)}
		</table>

		<h3>Settings</h3>
		<form onsubmit=${async (event: Event) => {
			event.preventDefault();
			self.data.status = 'Saving ...';
			const settings = [...dirtySettings
				.entries()
				.map(([key, value]) => ({
					key,
					value,
				}))
			];
			dirtySettings.clear();
			try {
				await admin.saveSettings(null, settings);
				await load();
				self.data.status = 'Saved.';
			} catch {
				self.data.status = 'Error Saving.';
			}
		}}>
			<table>
			${list('settings', [], (setting: Setting) => html`<tr>
				<td><b>${setting.key}</b>${setting.description
					? `<br /><span style='opacity: 0.75;'>${setting.description}</span>`
					: ''
				}</td>
				<td>${SettingInput(setting, dirtySettings)}</td>
			</tr>`)}
			</table>
			<input type='submit' value='Save Settings' />
			<span>${text('status', 'Loaded')}</span>
		</form>

		<h3>System Information</h3>
		<table>
			${list('attributes', (attr: SystemAttribute) => html`<tr>
				<td>
					<b>${attr.name}</b>
					<br /><span style='opacity: 0.75'>${attr.description}</span>
				</td>
				<td>${attr.value || `<span style='opacity: 0.75;'>EMPTY</span>`}</td>
				<td>${copyValueButton(attr.value)}</td>
			</tr>`)}
		</table>
	<div>`.onadd(load);

	return self;
}

async function App() {
	const self = html`<div id='app'>
		${await AuthenticatedContent({
			authenticated: async () => {
				return (await admin.isAdmin(null)) ?
					html`<div><p>Your <b>are</b> an admin.</p>${Admin()}</div>`
					: html`<p>You are <b>NOT</b> an admin.</p>`
			},
			unauthenticated: () => html`<p>You are not signed in.</p>`,
		})}
	</div>`;
	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Admin',
		content: await App(),
	});
}

hydrate('app', App as any);
