import { hello } from 'my-api';
import { html, text, node } from 'wirejs-dom/v2';

/**
 * Counts down from a given time.
 * 
 * @param {number} from - The time to count down "from".
 * @returns 
 */
export async function Countdown(T = 10) {
	return html`<div>
		${node('remaining', T, timeOrGreeting => {
			if (typeof timeOrGreeting === 'string') {
				return html`<div>${timeOrGreeting}</div>`;
			} else if (timeOrGreeting === 0) {
				return html`<div><b>ALL DONE!</b></div>`;
			} else if (timeOrGreeting === 1) {
				return html`<div><i>ONE second left!!!</i></div>`;
			} else {
				return html`<div>${timeOrGreeting} seconds remaining ...</div>`;
			}
		})}
	</div>`.onadd(self => {
		function tick() {
			self.data.remaining = self.data.remaining - 1;
			if (self.data.remaining > 0) {
				setTimeout(() => tick(), 1000);
			} else {
				hello("So and so").then(r => self.data.remaining = r);
			}
		};
		tick();
	});
};

export default Countdown;
