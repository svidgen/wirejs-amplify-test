import { withContext, RealtimeService, AuthenticationApi } from "wirejs-resources";

const realtimeService = new RealtimeService<{
	username: string;
	body: string;
}>('app', 'realtime');

function sanitizedRoomName(room: string | null): string {
	if (room === null || room === '') {
		return 'default';
	}
	return room.replace(/[^-_a-zA-Z0-9]/g, '-').slice(0, 50);
}

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
		return realtimeService.getStream(sanitizedRoomName(room));
	}
}));