import { html, node, hydrate } from 'wirejs-dom/v2';
import { auth } from 'internal-api';
import { AccountMenu } from '../components/index.js';
import type { AuthenticationState } from 'wirejs-resources';

const TITLE = 'My New Site';
const SUBTITLE = 'Made with wirejs';
const MENU_ID = 'account-menu';
const DISCLAIMER = html`<div>
	<p>For the purposes of awesomeness only.</p>
</div>`;

async function Account() {
	return html`<div id='${MENU_ID}'>
		${AccountMenu({ api: auth })}
	</div>`;
}

export async function Main(slots: {
	/**
	 * Replaces the default prefix in the final page title.
	 */
	siteTitle?:
		| string
		| ((state: AuthenticationState) => string);

	/**
	 * Appears on the page under the site title.
	 * 
	 * Set to empty-string explicitly to omit the default.
	 */
	siteSubTitle?:
		| string
		| ((state: AuthenticationState) => string);

	/**
	 * The page title. Appears below the site title and subtitle when given.
	 */
	pageTitle?:
		| string
		| ((state: AuthenticationState) => string);

	/**
	 * Author for this page. Appears next to the title in lighter font and
	 * in the address bar.
	 */
	pageAuthor?:
		| string
		| ((state: AuthenticationState) => string);

	/**
	 * The main content for the page.
	 */
	content:
		| HTMLElement
		| ((state: AuthenticationState) => HTMLElement);

	/**
	 * Appears in the top of the footer.
	 */
	disclaimer?: 
		| string
		| HTMLElement
		| ((state: AuthenticationState) => string | HTMLElement);
}) {

	const pageAuthorElement = slots.pageAuthor ? html`
		<span style='color: var(--color-muted);'>
			: according to <a href='/wiki/view/~${slots.pageAuthor}'>${slots.pageAuthor}</a>
		</span>
	` : '';

	const pageTitle = slots.pageTitle ? html`
		<h2 style='font-variant: small-caps;'>
			${slots.pageTitle} ${pageAuthorElement}
		</h2>
	` : '';

	const browserBarTitle = [
		slots.pageTitle,
		slots.pageAuthor,
		slots.siteTitle || TITLE,
		slots.siteSubTitle || SUBTITLE,
	].filter(Boolean).slice(0, 3).join(' - ');

	const page = html`
		<!doctype html>
		<html id='root'>
			<head>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${browserBarTitle}</title>
				<link rel='icon' type='image/svg+xml' href='/images/logo.svg' />
				<link rel='stylesheet' type='text/css' href='/default.css' />
			</head>
			<body>
				<div style='
					border-width: 0 1px;
					border-color: silver;
					border-style: solid;
					max-width: 1200px;
					min-height: 100vh;
					padding: 0 1rem;
					margin: 0 auto;
					overflow: hidden;
				'>
					<div style='
						display: flex;
						width: 100%;
						padding-bottom: 0.5rem;
						border-bottom: 1px solid var(--border-color-muted, #777);
						margin-bottom: 1rem;
					'>
						<!-- source: https://www.svgrepo.com/svg/322460/greek-temple -->
						<svg
							style='
								margin-top: 1.4rem;
								margin-right: 0.5rem;
							'
							height='4rem'
							viewBox="0 0 512 512"
							xmlns="http://www.w3.org/2000/svg"
						><path fill="#000000" d="M256 26.2L52 135h408L256 26.2zM73 153v14h366v-14H73zm16 32v206h30V185H89zm101.334 0v206h30V185h-30zm101.332 0v206h30V185h-30zM393 185v206h30V185h-30zM73 409v30h366v-30H73zm-32 48v30h430v-30H41z"/></svg>
						
						<div style='flex-basis: 0; flex-grow: 5;'>
							<h1 style='font-variant: small-caps; text-shadow: silver 2px 2px 2px;'>
								<a href='/' style='color: var(--color-strong, #000);'>${
									slots.siteTitle || TITLE
								}</a>
							</h1>

							<div style='
								margin-top: -1rem;
								color: var(--color-muted, #888);
							'>${slots.siteSubTitle ?? SUBTITLE}</div>
						</div>

						<div style='margin-top: 3.5rem; flex-grow: 0;'>
							${node('account', await Account())}
						</div>
					</div>

					${pageTitle}

					<div id='content'>${slots.content}</div>
					
					<footer>
						${slots.disclaimer ?? DISCLAIMER}
					</footer>
				</div>
			</body>
		</html>
	`;
	return page;
}

// TODO: fix wirejs `hydrate()` type
hydrate(MENU_ID, Account as any);