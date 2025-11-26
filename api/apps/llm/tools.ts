import { dedent } from "./utils.js";
import type { ToolDefinitions } from "./types.js";

export const standard: ToolDefinitions = {
	webFetch: {
		description: dedent`
			Fetches and analyzes web content. Use when:
			1. User asks about specific websites/URLs
			2. User wants latest/recent news or information
			3. Topic changes frequently and your knowledge may be outdated
			4. Conversation critically requires accurate current data
			5. User needs information you would not have from training
			6. User explicitly requests external/web content.
		`,
		arguments: ['url: string'],
		async execute(url: string) {
			console.log(`[webFetch] Starting comprehensive analysis for: ${url}`);

			try {
				// Use the same fetch logic as httpGet but optimized for analysis
				const controller = new AbortController();
				const timeoutId = setTimeout(() => {
					console.log(`[webFetch] Timeout reached for: ${url}`);
					controller.abort();
				}, 20000); // 20 second timeout for analysis

				console.log(`[webFetch] Fetching content from: ${url}`);
				const request = await fetch(url, {
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
				console.log(`[webFetch] Fetched ${body.length} characters for comprehensive analysis from: ${url}`);
				
				// Return raw content - chunking will be handled automatically by executeToolWithSubAgent
				return body;

			} catch (error) {
				console.error(`[webFetch] Error analyzing ${url}:`, error);
				if (error instanceof Error && error.name === 'AbortError') {
					throw new Error(`Analysis timeout after 20 seconds for: ${url}`);
				}
				throw error;
			}
		}
	},
};