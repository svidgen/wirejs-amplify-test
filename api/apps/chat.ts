import {
	AuthenticationApi,
	BackgroundJob,
	CronJob,
	RealtimeService,
	withContext,
} from "wirejs-resources";

const realtimeService = new RealtimeService<{
	username: string;
	body: string;
}>('app', 'realtime');

const counter = new BackgroundJob('app', 'countdowns', {
	handler: async (room: string, seconds: number) => {
		console.log(`Starting countdown in room "${room}" for ${seconds} seconds.`);
		return new Promise<void>((resolve) => {
			let remaining = seconds;
			const interval = setInterval(() => {
				console.log(`Time remaining in room "${room}": ${remaining} seconds`);
				if (remaining <= 0) {
					clearInterval(interval);
					resolve();
				} else {
					realtimeService.publish(sanitizedRoomName(room), [{
						username: 'Countdown',
						body: `Time remaining: ${remaining--} seconds`
					}]);
				}
			}, 1000);
		});
	},
});

new CronJob('app', 'chat-ping', {
	schedule: '*/5 * * * *',
	async handler() {
		const now = new Date();
		const nowString = now.toLocaleString();
		const tzOffset = now.getTimezoneOffset() / 60;
		const tzOffsetString = tzOffset ? `+${tzOffset}` : `-${tzOffset}`;
		const tz = `UTC${tzOffsetString}`;

		realtimeService.publish('test', [{
			username: 'cron',
			body: `Hi. Just here to let you know what time it is. It's ${nowString} ${tz} ...`
		}])
	}
});

export const Chat = (auth: AuthenticationApi) => withContext(context => ({
	async publish(room: string, message: string) {
		const user = await auth.requireCurrentUser(context);
		return realtimeService.publish(sanitizedRoomName(room), [{
			username: user.displayName,
			body: message
		}]);
	},
	async getRoom(room: string) {
		await auth.requireCurrentUser(context);
		return realtimeService.getStream(context, sanitizedRoomName(room));
	},
	async startCountdown(room: string, seconds: number) {
		await auth.requireCurrentUser(context);
		if (seconds < 5 || seconds > 600) {
			throw new Error('Countdown must be between 5 and 60 seconds.');
		}
		await counter.start(sanitizedRoomName(room), seconds);
	}
}));

function sanitizedRoomName(room: string | null): string {
	if (room === null || room === '') {
		return 'default';
	}
	return room.replace(/[^-_a-zA-Z0-9]/g, '-').slice(0, 50);
}