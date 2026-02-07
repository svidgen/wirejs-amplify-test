
import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';

/**
 * Generate a random number of random characters.
 * 
 * Intended for inclusion in chunks sent over the wire for security purposes. Chunks
 * are otherwise more susceptible to snooping.
 * 
 * @returns 
 */
export const pad = () => randomUUID().slice(0, 1 + Math.floor(Math.random() * 16));

/**
 * Generate a 64 bit integer ID based on time and randomness. Suitable for
 * non-globally unique IDs (sub-IDs) that just need to be sortable based on
 * create or update time.
 * 
 * @returns
 */
export const intId = () => Math.floor((Date.now() + Math.random()) * 10_000);

/**
 * Cleans up quotes from a title that may have been provided by an LLM.
 * 
 * @param title 
 * @returns 
 */
export const cleanTitle = (title: string) => {
	let cleanTitle = title.trim();
	if ((cleanTitle.startsWith('"') && cleanTitle.endsWith('"')) ||
		(cleanTitle.startsWith("'") && cleanTitle.endsWith("'"))) {
		cleanTitle = cleanTitle.slice(1, -1).trim();
	}
	return cleanTitle;
}

/**
 * Extract "content"-like text from HTML using common patterns to ignore headers, footers,
 * navigation, extra whitespace, etc.
 */
export const extractContentFromHtml = (html: string): string => {
	if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
		return html;
	}

	try {
		console.log(`[HTML] Starting cheerio extraction from ${html.length} chars`);

		// Load HTML into cheerio for DOM manipulation
		const $ = cheerio.load(html);

		// Remove unwanted elements entirely (more efficient than regex)
		$('script, style, nav, header, footer, aside').remove();
		$('.mw-navigation, .navbox, .infobox, .sidebar').remove(); // Wikipedia-specific
		$('[class*="nav"], [class*="menu"], [class*="sidebar"]').remove(); // Common patterns

		// Remove common noise elements
		$('.reference, .citation, sup.reference').remove(); // Citations
		$('.printfooter, .catlinks').remove(); // Wikipedia footer stuff
		$('table.ambox, .hatnote').remove(); // Wikipedia message boxes

		// Extract text with cleaned up whitespace
		let text = $('body').text()
			.replace(/\s+/g, ' ')          // Normalize whitespace
			.replace(/\[\d+\]/g, '')       // Remove citation numbers [1], [2], etc.
			.replace(/\s*\n\s*/g, '\n')    // Clean line breaks
			.replace(/\n{3,}/g, '\n\n')    // Limit consecutive newlines
			.trim();

		console.log(`[HTML] Final cheerio extracted text: ${text.length} chars`);
		return text;
	} catch (error) {
		console.error('Error extracting text with cheerio:', error);
		// Fallback to simple regex approach
		console.log('[HTML] Falling back to regex extraction');
		return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	}
};

/**
 * Convert async generator to array (for Node 20 compatibility)
 */
export async function fromAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of gen) {
		items.push(item);
	}
	return items;
}

/**
 * Removes leading whitespace on every line of input text.
 * 
 * This works by finding the minimum indent depth of a block of multi-line text and
 * left-trimming every line by the common (minimum) indent amount.
 * 
 * @param content 
 * @returns 
 */
function dedentString(content: string) {
	return dedentLines(content.split('\n')).join('\n');
}

function findMinimumIndent(lines: string[]) {
	let minimumIndent: number | undefined = undefined;
	for (const line of lines) {
		if (line.trim() === '') continue;

		const whitespace = line.match(/^\s+/)?.[0];
		if (!whitespace) continue;

		if (minimumIndent === undefined || whitespace.length < minimumIndent) {
			minimumIndent = whitespace.length;
		}
	}
	return minimumIndent;
}

function dedentLines(lines: string[]) {
	const output: string[] = [];
	const minimumIndent = findMinimumIndent(lines);
	for (const line of lines) {
		output.push(line.substring(minimumIndent ?? 0));
	}
	return output;
}

export function dedent(content: TemplateStringsArray, ...values: any[]) {
	const PH = '%%%___DEDENT_PLACEHOLDER___%%%';
	const combined = Array.from(content).join(PH);
	const dedentedContent = dedentString(combined).split(PH);
	return String.raw({ raw: dedentedContent }, ...values);
}

export function parseLLMJson(raw: string) {
	if (!raw || typeof raw !== "string") {
		throw new Error("Empty or non-string LLM output");
	}

	let text = raw.trim();

	if (text.startsWith("```")) {
		text = text.replace(/^```[a-zA-Z]*\s*/, "");
		text = text.replace(/```$/, "");
		text = text.trim();
	}

	if (text.toLowerCase().startsWith("json")) {
		const after = text.slice(4).trim();
		if (after.startsWith("{")) {
			text = after;
		}
	}

	return JSON.parse(text);
}