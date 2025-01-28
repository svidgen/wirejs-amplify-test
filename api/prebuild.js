import { writeFileSync } from 'fs';

let API_URL = '/api';
const indexModule = await import('./index.js');

try {
	const backendConfigModule = await import('./config.js');
	const backendConfig = backendConfigModule.default;
	console.log("backend config found", backendConfig);
	if (backendConfig.apiUrl) {
		API_URL = backendConfig.apiUrl;
	}
} catch {
	console.log("No backend API config found.");
}

function dedent(tabs, text) {
	const tabString = new Array(tabs).fill('\t').join('');
	return text.trim().replace(new RegExp(`^${tabString}`, 'gm'), '');
}

const apiCode = Object.keys(indexModule)
	.map(name => `export const ${name} = apiTree(${JSON.stringify([name])});`)
	.join('\n')
;

const baseClient = dedent(1, /* js */ `
	async function wirejsCallApi(method, ...args) {
		let cookieHeader = {};
		if (typeof args[0]?.cookies?.getAll === 'function') {
			const cookies = args[0]?.cookies?.getAll();
			cookieHeader = typeof cookies === 'object'
				? {
					Cookie: Object.entries(cookies).map(kv => kv.join('=')).join('; ')
				}
				: {};
		}

		const response = await fetch("${API_URL}", {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...cookieHeader
			},
			body: JSON.stringify([{method, args:[...args]}]),
		});
		const body = await response.json();

		const error = body[0].error;
		if (error) {
			throw new Error(error);
		}

		const value = body[0].data;
		return value;
	};

	function apiTree(path = []) {
		return new Proxy(function() {}, {
			apply(_target, _thisArg, args) {
				return wirejsCallApi(path, ...args);
			},
			get(_target, prop) {
				return apiTree([...path, prop]);
			}
		});
	};
`);

writeFileSync('index.client.js', [baseClient, apiCode].join('\n\n'));