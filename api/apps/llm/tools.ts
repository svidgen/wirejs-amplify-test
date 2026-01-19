import { dedent, extractContentFromHtml } from "./utils.js";
import type { ToolDefinitions } from "./types.js";

const rawFetch = async (url: string) => {
	try {
		const parsedUrl = new URL(
			['http://', 'https://'].some(p => url.startsWith(p)) ? url : `https://${url}`
		);

		// Use the same fetch logic as httpGet but optimized for analysis
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			console.log(`Fetch timeout reached for: ${url}`);
			controller.abort();
		}, 20000); // 20 second timeout for analysis

		console.log(`Fetching content from: ${url}`);
		const request = await fetch(parsedUrl, {
			signal: controller.signal,
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; WireJS-Analyzer/1.0)',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
			}
		});

		clearTimeout(timeoutId);

		if (!request.ok) {
			throw new Error(`HTTP ${request.status}: ${request.statusText}`);
		}

		const body = await request.text();
		console.log(`Fetched ${body.length} characters from: ${url}`);
		
		return body;

	} catch (error) {
		console.error(`Error fetching ${url}:`, error);
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Fetch timeout after 20 seconds for: ${url}`);
		}
		throw error;
	}
}

export const standard: ToolDefinitions = {
	describe_capabilities: {
		description: dedent`
			Describes the list of actions that can be performed.
		`,
		arguments: {},
		async execute() {
			const { describe_capabilities, ...actions } = standard;
			const def = JSON.stringify(actions, null, 2);
			return `Available Actions and Capabilities:\n${def}`
		}
	},
	fetch: {
		description: dedent`
			Fetch raw content from an HTTP(S) URL via a GET request.
		`,
		arguments: {
			url: {
				type: 'string',
				description: "Fully qualified URL string to fetch."
			}
		},
		async execute({ url }: { url: string }) {
			console.log(`[fetch] Received request for: ${url}`);
			return rawFetch(url);			
		}
	},
	fetch_html_content_text: {
		description: dedent`
			Extract the text content from HTML at the given URL.
		`,
		arguments: {
			url: {
				type: 'string',
				description: "Fully qualified URL string to fetch."
			}
		},
		async execute({ url }: { url: string }) {
			console.log(`[natural language fetch] Received request for: ${url}`);
			const content = extractContentFromHtml(await rawFetch(url));
			console.log(`Extracted content:\n${content}`);
			return content;
		}
	},
	// web_search: {
	// 	description: dedent`
	// 		Searches the web
	// 	`
	// }
};