import { LLMMessage } from "wirejs-resources";
import { Infra } from "./infra.js";
import { pad } from "./utils.js";
import type { ConversationMessage } from "./types.js";

function mapRawHistoryToMessages(messages: ConversationMessage[]) {
	const history: LLMMessage[] = [];
	for (const m of messages) {
		if (m.role === 'user' || m.role === 'assistant') {
			history.push({
				role: m.role,
				content: m.content
			});
		}
	}
	return history;
}

export class Response {
	seq: number = 0;

	constructor(
		public infra: Infra,
		public room: string,
	) {}

	start() {

	}
}