import {
	AuthenticationApi,
	Endpoint as InternalEndpoint,
	Setting as InternalSetting,
	withContext,
} from "wirejs-resources";

const permanentAdmins = ['admin', 'iambipedal@gmail.com'];

export type Setting = {
	key: string;
	value: string;
	description: string;
	isPrivate: boolean;
	options?: string[];
};

export type Endpoint = {
	id: string;
	path: string;
	url: string;
	description: string;
};

export type SystemAttribute = {
	name: string;
	value: string;
	description: string;
};

export const Admin = (auth: AuthenticationApi) => withContext(context => {
	const api = {
		async isAdmin() {
			const user = await auth.getCurrentUser(context);
			if (!user) return false;
			return permanentAdmins.includes(user.username);
		},
		async requireAdmin() {
			if (!await api.isAdmin()) throw new Error("You are not an admin.");
		},
		async listSettings() {
			await api.requireAdmin();
			let results: Setting[] = [];
			for (const setting of InternalSetting.list()) {
				results.push({
					key: setting.absoluteId,
					value: await setting.read(),
					description: setting.description || '',
					options: setting.options,
					isPrivate: setting.isPrivate,
				});
			}
			return results;
		},
		async saveSettings(settings: { key: string, value: string }[]) {
			await api.requireAdmin();
			for (const { key, value } of settings) {
				const setting = InternalSetting.get(key);
				if (setting) await setting.write(value)
			}
		},
		async listEndpoints() {
			await api.requireAdmin();
			const endpoints: Endpoint[] = [];
			for (const endpoint of InternalEndpoint.list()) {
				endpoints.push({
					id: endpoint.absoluteId,
					description: endpoint.description || '',
					path: endpoint.path,
					url: await endpoint.determineUrl(),
				});
			}
			return endpoints;
		},
		async listSystemAttributes(): Promise<SystemAttribute[]> {
			await api.requireAdmin();
			return context.systemInfo.map(attr => ({
				name: attr.name,
				value: attr.value || '',
				description: attr.description
			})).toArray();
		},
	};
	return api;
});