import { SingleWorker } from 'wirejs-web-worker';

export const worker = SingleWorker({
	async count(
		upTo: number,
		options?: { tick?: (pct: number) => void }
	) {
		let lastUpdate = new Date();
		options?.tick?.(0);
		let c = 0;
		for (let i = 0; i < upTo; i++) {
			let current = new Date();
			if (current.getTime() - lastUpdate.getTime() > 50) {
				options?.tick?.(i / upTo);
				lastUpdate = current;
			}
			c++;
		}
		options?.tick?.(1);
		return c;
	}
});