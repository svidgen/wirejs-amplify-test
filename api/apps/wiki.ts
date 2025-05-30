import { withContext, FileService, AuthenticationApi } from "wirejs-resources";
const wikiPages = new FileService('app', 'wikiPages');

function normalizeWikiPageFilename(page: string) {
	return page.replace(/[^-_a-zA-Z0-9/]/g, '-') + '.md';
}

export const Wiki = (auth: AuthenticationApi) => withContext(context => ({
	async read(page: string) {
		const filename = normalizeWikiPageFilename(page);
		try {
			return await wikiPages.read(filename);
		} catch (error) {
			return null;
		}
	},
	async write(page: string, content: string) {
		await auth.requireCurrentUser(context);

		const filename = normalizeWikiPageFilename(page);
		await wikiPages.write(filename, content);

		return true;
	}
}));