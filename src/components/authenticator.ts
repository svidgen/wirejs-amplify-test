import { attribute, html, node } from 'wirejs-dom/v2';
import type {
	AuthenticationApi,
	AuthenticationState,
	AuthenticationMachineState,
	AuthenticationMachineAction,
	AuthenticationMachineInput,
} from 'wirejs-resources';

type AuthCallback = (state: AuthenticationMachineState) => any;

export const authenticatoraction = (
	action: AuthenticationMachineAction,
	act: (input: AuthenticationMachineInput) => void
) => {
	const inputs = Object.entries(action.fields || []).map(([name, { label, type }]) => {
		const id = `input_${Math.floor(Math.random() * 1_000_000)}`;
		const input = html`<div>
			<label for=${id}>${label}</label>
			<br />
			<input
				id=${id}
				name=${name}
				type=${type}
				value=${attribute('value', '')}
				style='width: calc(100% - 1rem); margin-bottom: 0.5rem;'
			/>
		</div>`.extend(self => ({
			data: { name }
		}));
		return input;
	});

	const buttons = action.buttons?.map(b => html`<p>
		<button type='submit' value='${b}'>${b}</button>
	</p>`);

	const link = buttons ? undefined : [
		html`<p><a
			style='cursor: pointer; font-weight: bold;'
			onclick=${() => act({ key: action.key })}
		>${action.name}</a></p>`
	];

	const actors = link ?? buttons;

	if (action.fields && Object.keys(action.fields).length > 0) {
		return html`<authenticatoraction>
			<div>
				<h4 style='margin-top: 1rem; margin-bottom: 0.5rem;'>${action.name}</h4>
				<form
					onsubmit=${(evt: SubmitEvent) => {
						evt.preventDefault();
						act({
							key: action.key,
							verb: (evt.submitter as any)?.value,
							inputs: Object.fromEntries(inputs.map(input => ([
								input.data.name,
								input.data.value
							])))
						});
					}}
				>
					${inputs}
					${actors}
				</form>
				<hr style='width: 33%; height: 1px; border: none; background: silver;' />
			</div>
		</authenticatoraction>`;
	} else {
		return html`<authenticatoraction>
			${actors}
		</authenticatoraction>`;
	}
}

export const authenticator = (
	stateManager: AuthenticationApi,
	initialState?: AuthenticationMachineState
) => {
	const listeners = new Set<AuthCallback>();
	let lastKnownState: AuthenticationMachineState | undefined = undefined;

	const self = html`<authenticator style='display: block; min-width: 15em;'>
		${node('state', html`<span>Loading ...</span>` as HTMLElement)}
	</authenticator>`.extend(() => ({
		renderState(state: AuthenticationMachineState | { errors: any[] }) {
			if ('errors' in state && state.errors) {
				alert((state as any).errors.map((e: any) => e.message).join("\n\n"));
			} else {
				lastKnownState = state as AuthenticationMachineState;
				self.data.state = html`<div>
					<div>${lastKnownState.message || ''}</div>
					<div>${Object.entries(lastKnownState.actions).map(([_key, action]) => {
						return authenticatoraction({...action}, async act => {
							self.renderState(await stateManager.setState(null, act));
						});
					})}</div>
				</div>`;
			}
			for (const listener of listeners) {
				try {
					listener(state as AuthenticationMachineState);
				} catch (error) {
					console.error("Error calling auth state listener.");
				}
			}
		}
	})).onadd(async (self) => {
		if (initialState) {
			console.log('authenticator render state');
			self.renderState(initialState)
		}
	}).extend(self => ({
		data: {
			setState: (state: AuthenticationMachineState) => self.renderState(state),
			onchange: (callback: AuthCallback) => {
				listeners.add(callback);
			},
			removeonchange: (callback: AuthCallback) => {
				listeners.delete(callback);
			},
			focus: () => {
				[...self.getElementsByTagName('input')].shift()?.focus();
			},
			get lastKnownState() {
				return lastKnownState;
			}
		}
	}));

	return self;
};