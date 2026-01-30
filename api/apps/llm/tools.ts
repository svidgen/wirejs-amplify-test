import { dedent, extractContentFromHtml } from "./utils.js";
import type { ToolDefinitions } from "./types.js";
import { JSDOM } from "jsdom";

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
	// describe_capabilities: {
	// 	description: dedent`
	// 		Describes the list of actions that can be performed.
	// 	`,
	// 	arguments: {},
	// 	async execute() {
	// 		const { describe_capabilities, ...actions } = standard;
	// 		const def = JSON.stringify(actions, null, 2);
	// 		return `Available Actions and Capabilities:\n${def}`
	// 	}
	// },
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
		async execute({ url } : { url: string }) {
			console.log(`[fetch] Received request for: ${url}`);
			return rawFetch(url);			
		}
	},
	fetch_html_content_text: {
		description: dedent`
			Extract the text content from HTML at the given URL.
			This should be the default when fetching "content" from an HTML page, since it
			avoids the overhead of flooding the context window with raw HTML.
		`,
		arguments: {
			url: {
				type: 'string',
				description: "Fully qualified URL string to fetch."
			}
		},
		async execute({ url } : { url: string }) {
			console.log(`[natural language fetch] Received request for: ${url}`);
			const content = extractContentFromHtml(await rawFetch(url));
			console.log(`Extracted content:\n${content}`);
			return content;
		}
	},
	web_search: {
		description: dedent`
			Searches the web using DuckDuckGo.
		`,
		arguments: {
			query: {
				type: 'string',
				description: 'Search text to use for searching the web. Supports DuckDuckGo search syntax.'
			}
		},
		async execute({ query } : { query: string }) {
			console.log(`[searching] query: ${query}`);
			const rawHtml = await rawFetch(`https://html.duckduckgo.com/html/?q=${query}`);
			return parseDuckDuckGoResults(rawHtml);
		}
	}
};

const parseDuckDuckGoResults = (html: string) : string => {
	const results: Array<{ url: string; title: string; description: string }> = [];
	const dom = new JSDOM(html);
	const doc = dom.window.document;
	
	const resultElements = doc.querySelectorAll('.result');
	
	resultElements.forEach((element) => {
		const titleEl = element.querySelector('.result__a');
		const snippetEl = element.querySelector('.result__snippet');
		const linkEl = element.querySelector('a.result__a') as HTMLAnchorElement;
		
		if (titleEl && snippetEl && linkEl) {
			const url = new URL(linkEl.getAttribute('href') || '', 'https://html.duckduckgo.com');
			const uddgParam = url.searchParams.get('uddg');
			const decodedUrl = uddgParam ? decodeURIComponent(uddgParam) : '';
			
			results.push({
				url: decodedUrl,
				title: titleEl.textContent?.trim() || '',
				description: snippetEl.textContent?.trim() || ''
			});
		}
	});
	
	return JSON.stringify(results, null, 2);
};