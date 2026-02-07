import { dedent, extractContentFromHtml } from "./utils.js";
import type { ToolDefinition } from "./types.js";
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

/**
 * Standard tool definitions include searching and fetching web content.
 */
export const standard: ToolDefinition[] = [
	{
		name: 'fetch',
		description: dedent`
			Fetches raw content from an HTTP(S) URL via a GET request.

			Use fetch ONLY when the URL is known and expected to contain
			"raw data" like CSV, JSON, XML, YML, or plain text.
		`,
		parameters: {
			type: 'object',
			properties: {	
				url: {
					type: 'string',
					description: "Fully qualified URL string to fetch."
				}
			}
		},
		async execute({ url } : { url: string }) {
			console.log(`[fetch] Received request for: ${url}`);
			return rawFetch(url);			
		}
	},
	{
		name: 'fetch_html_content_text',
		description: dedent`
			Extracts the text content from HTML at the given URL.

			Use fetch_html_content_text ONLY when the URL is known and expected
			to be an HTML page with meaningful content to extract.
		`,
		parameters: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: "Fully qualified URL string to fetch."
				}
			}
		},
		async execute({ url } : { url: string }) {
			console.log(`[natural language fetch] Received request for: ${url}`);
			const content = extractContentFromHtml(await rawFetch(url));
			console.log(`Extracted content:\n${content}`);
			return content;
		}
	},
	{
		name: 'web_search',
		description: dedent`
			Searches the web using DuckDuckGo.

			Use web_search ONLY when user intent indicates a need for information beyond
			your training or if the subject matter is temporally sensitive AND when a
			web search is likely to provide the URL you need for a future fetch or
			fetch_html_content_text call.
		`,
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search text to use for searching the web. Supports DuckDuckGo search syntax.'
				}
			}
		},
		async execute({ query } : { query: string }) {
			console.log(`[searching] query: ${query}`);
			const rawHtml = await rawFetch(`https://html.duckduckgo.com/html/?q=${query}`);
			return parseDuckDuckGoResults(rawHtml);
		}
	}
];

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