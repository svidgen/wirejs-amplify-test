
import * as cheerio from 'cheerio';

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
 * Chunk text with an overlap.
 * 
 * ```typescript
 * chunkTextWithOverlap("abcdefghijklmnopqrstuvwxyz", 10, 2);
 * ```
 * 
 * Should return:
 * 
 * ```typescript
 * ["abcdefghij", "ijklmnopqr", "qrstuvwxyz"]
 * ```
 */
export const chunkTextWithOverlap = (
	text: string,
	chunkSize: number = 30_000 * 2.5,
	overlapSize: number = 1000 * 2.5
): string[] => {
	if (text.length <= chunkSize) {
		return [text];
	}
	
	const chunks: string[] = [];
	let start = 0;
	
	while (start < text.length) {
		let end = Math.min(start + chunkSize, text.length);
		
		// For larger chunks, try multiple natural break points
		if (end < text.length) {
			// Look for natural breaks in order of preference
			const breakPoints = [
				text.lastIndexOf('\n\n', end),      // Paragraph breaks (best)
				text.lastIndexOf('. ', end),        // Sentence breaks (good)  
				text.lastIndexOf('.\n', end),       // End of sentence with newline
				text.lastIndexOf(', ', end),        // Clause breaks (okay)
				text.lastIndexOf(' ', end)          // Word breaks (fallback)
			];
			
			// Use the first break point that's in a reasonable position
			for (const breakPoint of breakPoints) {
				if (breakPoint > start + chunkSize * 0.7) {
					end = breakPoint + (text[breakPoint] === '\n' ? 2 : 2); // Include the break character(s)
					break;
				}
			}
		}
		
		chunks.push(text.slice(start, end));
		start = end - overlapSize; // Create overlap for context continuity
		
		// Ensure we don't go backwards
		if (start <= chunks[chunks.length - 1].length - overlapSize) {
			start = chunks[chunks.length - 1].length - overlapSize + 1;
		}
	}
	
	return chunks;
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

/**
 * Takes an array of string chunks and maps it to an async processor.
 * 
 * @param content 
 * @param process 
 * @returns
 */
export const chunkMap = async (
	chunks: string[],
	process: (content: string) => Promise<string>
): Promise<string[]> => {
	const results: string[] = [];
	for (const chunk of chunks) {
		results.push(await process(chunk));
	}
	return results;
};

/**
 * Takes a array of text chunks and reduces them with a text chunks processor.
 * 
 * Recurses if the chunk size is too large to reduce in a single pass.
 * 
 * @param chunks 
 * @param process 
 * @param characterLimit 
 * @returns 
 */
export const chunkReduce = async (
	chunks: string[],
	process: (chunks: string[]) => Promise<string>,
	characterLimit: number = 30_000 * 2.5  // fairly safe at 2.5 characters per token
): Promise<string> => {
	const batches: string[][] = [];
	
	let batch: string[] = [];
	let batchSize: number = 0;
	for (const chunk of chunks) {
		if (batchSize === 0 || batchSize + chunk.length < characterLimit) {
			batch.push(chunk);
			batchSize += chunk.length;
		} else {
			batches.push(batch);
			batch = [];
			batchSize = 0;
		}
	}

	// ensure we capture the last batch
	if (batch.length > 0) {
		batches.push(batch);
		batch = [];
		batchSize = 0;
	}

	// if no batches, need to let processor decide what to do
	if (batches.length === 0) {
		return process([]);
	}

	// single batch is the final base case -- need to hand off to processor for final results.
	if (batches.length === 1) {
		return process(batches[0]);
	}

	// if more than a single batch, we have to much content and need to reduce recursively.
	// if we have more than we can reduce recursively, we'll get an exception. that's OK
	// for now. this isn't intended for processing "that much" text, necessarily ...
	const batchResults: string[] = [];
	for (const batch of batches) {
		batchResults.push(await chunkReduce(batch, process, characterLimit));
	}
	return chunkReduce(batchResults, process, characterLimit);
}