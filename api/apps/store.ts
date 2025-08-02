import { AuthenticationApi, withContext } from 'wirejs-resources';
import {
	PaymentService,
	OneTimeProduct,
	SubscriptionProduct,
	OneTimePurchaseLineItem,
	SubscriptionLineItem,
} from 'wirejs-module-payments-stripe';

export type { Product, Transaction, SubscriptionLine, OneTimePurchaseLineItem } from 'wirejs-module-payments-stripe';

const payments = new PaymentService('app', 'payments');

const products: OneTimeProduct[] = [
	{
		id: 'something-a',
		name: 'something a',
		type: 'one_time',
		currency: 'usd',
		unitAmount: 2345,
		metadata: {}
	},
	{
		id: 'something-b',
		name: 'something b',
		type: 'one_time',
		currency: 'usd',
		unitAmount: 1234,
		metadata: {}
	},
	{
		id: 'something-c',
		name: 'something c',
		type: 'one_time',
		currency: 'usd',
		unitAmount: 999,
		metadata: {}
	},
];

const plans: SubscriptionProduct[] = [
	{
		id: 'plan-a',
		name: 'plan a',
		type: 'recurring',
		currency: 'usd',
		unitAmount: 1299,
		interval: 'month',
		metadata: {}
	}
];

export const Store = (auth: AuthenticationApi) => withContext(context => ({
	async listProducts() {
		return [...products, ...plans];
	},
	async getCheckoutUrl({ cart, successUrl, cancelUrl }: {
		cart: { id: string, quantity: number }[];
		successUrl: string;
		cancelUrl: string;
	}) {
		const user = await auth.requireCurrentUser(context);
		return payments.createCheckoutUrl({
			customer: {
				id: user.id
			},
			lineItems: cart.map(({id, quantity}): OneTimePurchaseLineItem => {
				return {
					product: products.find(p => p.id === id)!,
					quantity
				};
			}),
			successUrl,
			cancelUrl,
		});
	},
	async getSubscribeUrl({ cart, successUrl, cancelUrl }: {
		cart: { id: string }[];
		successUrl: string;
		cancelUrl: string;
	}) {
		const user = await auth.requireCurrentUser(context);
		return payments.createCheckoutUrl({
			customer: {
				id: user.id
			},
			lineItems: cart.map(({id}): SubscriptionLineItem => {
				return {
					product: plans.find(p => p.id === id)!,
					quantity: 1
				};
			}),
			successUrl,
			cancelUrl,
		});
	},
	async listPayments() {
		const user = await auth.requireCurrentUser(context);
		return payments.listPayments(user.id);
	},
	async listSubscriptions() {
		const user = await auth.requireCurrentUser(context);
		const subs = await payments.listSubscriptions(user.id);
		return subs.filter(s => s.status === 'active').map(s => ({
			...s,
			name: plans.find(p => p.id === s.productId)!.name
		}));
	},
	async cancelSubscription(subscriptionLineId: string) {
		const user = await auth.requireCurrentUser(context);
		const existing = await payments.getSubscriptionLine(subscriptionLineId);
		if (existing?.customerId !== user.id) {
			throw new Error("Subscription doesn't exist for this user.");
		}
		await payments.cancelSubscriptionLine(subscriptionLineId)
	}
}));