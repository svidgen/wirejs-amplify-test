import { AuthenticationApi, EmailSender, withContext } from 'wirejs-resources';

const testMailer = new EmailSender('app', 'testMailer', {
	from: 'wirejs-test@thepointless.com'
});

export const Mailer = (auth: AuthenticationApi) => withContext(context => ({
	/**
	 * Send a test message to yourself.
	 * 
	 * @param body 
	 */
	async sendTestMessage(subject: string, body: string) {
		const user = await auth.requireCurrentUser(context);
		await testMailer.send({
			to: user.username,
			body: `This is a test message from your wirejs app:\n\n${body}`,
			subject: `[wirejs test] ${subject}`
		});
	}
}));