import { html, list, attribute, hydrate } from 'wirejs-dom/v2';
import { AuthenticatedContent } from 'wirejs-components';
import { store, Product, Transaction } from 'internal-api';
import { Main } from '../layouts/main.js';

type LineItem = {
	productId: string;
	productName: string;
	price: string;
	quantity: number;
}

type SubscriptionLine = Awaited<ReturnType<
	typeof store.listSubscriptions>
>[number];

function renderAmount(inCents: number) {
	return `$${(inCents/100).toFixed(2)}`;
}

function Storefront() {
	const self = html`<div>

		<h4>Products</h4>
		<ol>${list('products', (p: Product) => html`<li>
			${p.name} : <span
				style='color: darkgreen; font-weight: bold; cursor: pointer;'
				onclick=${() => {
					const existing = self.data.cart.find(li => li.productId === p.id);
					if (existing) {
						const idx = self.data.cart.indexOf(existing);
						self.data.cart.splice(idx, 1, {
							...existing,
							quantity: existing.quantity + 1
						});
					} else {
						self.data.cart.push({
							productId: p.id,
							productName: p.name,
							price: `${renderAmount(p.unitAmount)}`,
							quantity: 1
						});
					}
				}}
			>add</span>
		</li>`)}</ol>
			
		<h4>Cart</h4>
		<ol>${list('cart', (li: LineItem) => html`<li>
			${li.productName} x ${li.quantity} : <span
				style='color: darkred; font-weight: bold; cursor: pointer;'
				onclick=${() => {
					self.data.cart.splice(self.data.cart.indexOf(li), 1);
				}}
			>remove</span>
		</li>`)}</ol>

		<div>
			<form onsubmit=${async (event: Event) => {
				event.preventDefault();
				document.location = (await store.getCheckoutUrl(null, {
					cart: self.data.cart.map(li => ({
						id: li.productId,
						quantity: li.quantity
					})),
					successUrl: document.location.href,
					cancelUrl: document.location.href,
				}))!;
			}}>
				<input type='submit' value='Checkout' />
			</form>
		</div>

		<h4>Transactions</h4>
		<table>
			<tr>
				<th>date</th>
				<th>amount</th>
				<th>items</th>
			</tr>
			${list('transactions', (t: Transaction) => html`<tr>
				<td>${new Date(t.createdAt).toLocaleDateString()}</td>
				<td>${renderAmount(t.amount)}</td>
				<td><table>
					${(t.items || []).map(li => html`<tr>
						<td>${li.description}</td>
						<td>x ${li.quantity}</td>
						<td>= ${renderAmount(li.amount)}</td>
					</tr>`)}
				</table></td>
			</tr>`)}
		</table>

		<h4>Subscription Plans</h4>
		<table>
			<tr>
				<th>Name</th>
				<th colspan='2'>Price</th>
				<th></th>
			</tr>
			${list('plans', (p: Product) => html`<tr>
				<td>${p.name}</td>
				<td>${renderAmount(p.unitAmount)}</td>
				<td>per ${p.interval}</td>
				<td
					style='color: darkgreen; font-weight: bold; cursor: pointer;'
					onclick=${() => {
						self.data.planCart.push(p);
						self.data.plans.splice(self.data.plans.indexOf(p), 1);
					}}
				>add</span>
			</tr>`)}
		</table>

		<h4>Subscription Cart</h4>
		<table>
			<tr>
				<th>Name</th>
				<th colspan='2'>Price</th>
				<th></th>
			</tr>
			${list('planCart', (p: Product) => html`<tr>
				<td>${p.name}</td>
				<td>${renderAmount(p.unitAmount)}</td>
				<td>per ${p.interval}</td>
				<td><span
					style='color: darkred; font-weight: bold; cursor: pointer;'
					onclick=${() => {
						self.data.planCart.splice(self.data.planCart.indexOf(p), 1);
						self.data.plans.push(p);
					}}
				>remove</span></td>
			</tr>`)}
		</table>

		<div>
			<form onsubmit=${async (event: Event) => {
				event.preventDefault();
				document.location = (await store.getSubscribeUrl(null, {
					cart: self.data.planCart.map(plan => ({ id: plan.id })),
					successUrl: document.location.href,
					cancelUrl: document.location.href,
				}))!;
			}}>
				<input type='submit' value='Subscribe' />
			</form>
		</div>

		<h4>Active Subscriptions</h4>
		<table>
			<tr>
				<th>Plan</th>
				<th colspan='2'>Quantity</th>
				<th colspan='2'>Amount</th>
				<th></th>
			</tr>
			${list('subscriptions', (s: SubscriptionLine) => html`<tr>
				<td>${s.name}</td>
				<td>${s.quantity}</td>
				<td>x</td>
				<td>${renderAmount(s.amount)}</td>
				<td>per ${s.interval}</td>
				<td><span
					style='color: darkred; font-weight: bold; cursor: pointer;'
					onclick=${async () => {
						const yes = confirm("Are you sure?");
						if (!yes) return;
						try {
							await store.cancelSubscription(null, s.id);
							self.data.subscriptions.splice(
								self.data.subscriptions.indexOf(s), 1
							);
						} catch (error) {
							alert(error);
						}
					}}
				>cancel</span></td>
			</tr>`)}
		</table>

	<div>`.onadd(async self => {
		const products = await store.listProducts(null);
		self.data.products = products.filter(p => p.type === 'one_time');
		self.data.plans = products.filter(p => p.type !== 'one_time');
		self.data.transactions = await store.listPayments(null);
		self.data.subscriptions = await store.listSubscriptions(null);
	});
	return self;
}

async function App() {
	const self = html`<div id='app'>
		${await AuthenticatedContent({
			authenticated: () => Storefront(),
			unauthenticated: () => html`<div>
				You need to sign in to buy things.
			</div>`
		})}
	</div>`;

	return self;
}

export async function generate() {
	return Main({
		pageTitle: 'Simple Storefront Demo',
		content: await App(),
	});
}

hydrate('app', App as any);
