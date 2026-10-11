const { html } = require('./html');
const config = require('./config');

const biz = () => config.businessName;
const mail = () => (config.supportEmail ? html`<a href="mailto:${config.supportEmail}">${config.supportEmail}</a>` : html`<em>[support email not yet configured by the site owner]</em>`);
const pmail = () => (config.privacyEmail ? html`<a href="mailto:${config.privacyEmail}">${config.privacyEmail}</a>` : mail());
const notice = html`<p class="alert alert-warning"><strong>Site owner:</strong> these pages are a starting template written for this software. They are not legal advice. Have them reviewed by a qualified lawyer for the countries you sell into and fill in your real business details in the environment settings before launch.</p>`;

module.exports = {
  privacy: () => html`<h1>Privacy policy</h1><p>Version ${config.policyVersion}. Controller: ${biz()}. ${config.address ? config.address : ''}</p>${notice}
  <h2>What we collect and why</h2><table class="table"><thead><tr><th scope="col">Information</th><th scope="col">Purpose</th><th scope="col">Legal basis (where applicable)</th><th scope="col">Kept for</th></tr></thead><tbody>
   <tr><th scope="row">Essential cookies: session ID, cart, currency, consent choice</th><td>Keep the site working, security, remember your cart and choices</td><td>Necessary for the service / legitimate interests</td><td>Up to 30 days (session cookie); choices up to 6 months</td></tr>
   <tr><th scope="row">Account details: name, email, password (stored only as a salted hash), confirmation that you are 13+</th><td>Operate your account</td><td>Contract</td><td>Until you ask us to delete your account</td></tr>
   <tr><th scope="row">Order enquiry: name, email, country, contact preference, message, cart contents and totals</th><td>Respond to your enquiry, arrange payment, ship and support your order</td><td>Contract; your consent to share enquiry details with support</td><td>Order records are kept as required by tax and accounting law (typically several years); personal details are anonymised once no longer needed</td></tr>
   <tr><th scope="row">Live chat messages and the name you enter</th><td>Provide support</td><td>Legitimate interests / contract</td><td>Up to 12 months, then deleted</td></tr>
   <tr><th scope="row">AI assistant messages (only if you opt in)</th><td>Answer product and policy questions</td><td>Your consent</td><td>Message text is not stored by us; we store only a usage record (time, status) for abuse prevention</td></tr>
   <tr><th scope="row">Newsletter email address</th><td>Marketing emails</td><td>Your consent</td><td>Until you unsubscribe</td></tr>
   <tr><th scope="row">Optional analytics</th><td>Understand site usage</td><td>Your consent</td><td>Per the analytics provider's settings</td></tr></tbody></table>
  <h2 id="ai">AI assistant and our AI provider</h2><p>The AI support assistant is powered by <strong>Anthropic</strong> (the Claude models). It is an AI, not a person. It is optional and off until you tick the consent box in the assistant window. When you use it, the text of your question plus relevant product and policy information from our catalogue is sent from our server to Anthropic to generate an answer. Before sending, we remove email addresses and phone numbers that we detect in your message, but you should not type personal or payment information into it. We never send payment details, your account password, your order history or your name. Anthropic processes this data under its own terms and privacy policy, and may process it outside your country. You can withdraw consent in the assistant window at any time, and you can reach a human through live chat or the contact page instead. Declining AI has no effect on browsing or buying.</p>
  <h2 id="choices">Your privacy choices</h2><p>We do not load analytics, advertising or similar trackers unless you accept them. ${config.analyticsSrc ? 'An analytics script is configured and loads only after you choose Accept.' : 'No analytics or advertising tracker is currently configured on this site.'}</p>
  <p><button class="btn" type="button" data-consent="accept">Accept analytics</button> <button class="btn btn-secondary" type="button" data-consent="reject">Reject non-essential</button></p>
  <h2>Sharing</h2><p>We share data only with: our hosting and database providers (to run the site), Anthropic (only when you use the AI assistant), and delivery or payment partners that we use to fulfil an order you have asked for. We do not sell personal data.</p>
  <h2>Security</h2><p>Passwords are hashed, traffic uses HTTPS in production, access to personal data is limited by staff role and logged. No system is perfectly secure.</p>
  <h2 id="deletion">Your rights and data deletion</h2><p>Depending on where you live you may have rights to access, correct, delete, restrict or port your data, to object to processing, and to withdraw consent. To delete your account and personal data use <a href="/data-deletion">our deletion request form</a>. We will verify your identity, remove or anonymise your personal data, and tell you if we must keep certain records (such as order and payment records) because the law requires it. You may also complain to your local data protection authority.</p>
  <h2>Children</h2><p>Accounts are for people aged 13 or over; we ask only for a yes/no age confirmation, not a date of birth. If you are under 13, ask a parent or guardian to place an enquiry for you. If we learn we hold an account of a child under 13 we will delete it.</p>
  <h2>Contact</h2><p>Privacy questions: ${pmail()}.</p>`,

  terms: () => html`<h1>Terms of service</h1>${notice}
  <h2>1. Who we are</h2><p>This site is operated by ${biz()}. Contact: ${mail()}.</p>
  <h2>2. How orders work</h2><p>The site does not take card or online payments. When you check out you send us an <strong>order enquiry</strong>. An enquiry is not a contract. We review it, contact you to confirm items, final price, shipping and any taxes, and arrange payment. A contract is formed only when we confirm payment and accept your order. We may decline an enquiry (for example because of stock or pricing errors).</p>
  <h2>3. Prices and availability</h2><p>Prices are shown in USD, GBP or CAD. Every product shows a 20% promotional discount off the list price displayed. Prices and stock are checked again by our server when you submit an enquiry and when payment is confirmed. Shipping is shown as an estimate; taxes and duties are not calculated on the site and will be confirmed to you before payment. Product listings in the current catalogue are sample listings for demonstration.</p>
  <h2>4. Shipping and returns</h2><p>See the <a href="/shipping">shipping page</a> and <a href="/refunds">refund policy</a>.</p>
  <h2>5. Accounts and acceptable use</h2><p>You must be 13 or older to hold an account. Keep your password secure. Do not misuse the site: no scraping that degrades the service, attempts to bypass security, abusive chat messages, or submitting false enquiries.</p>
  <h2>6. Liability</h2><p>Nothing limits liability that cannot be limited by law, including for death or personal injury caused by negligence, fraud, or your statutory consumer rights. Subject to that, we are not liable for indirect or consequential loss, and our total liability for an order is limited to the amount you paid for it.</p>
  <h2>7. Governing law</h2><p>These terms are governed by the law of the country in which the business is established, which the site owner must state here: <em>[governing law to be completed by the site owner]</em>. This does not remove mandatory consumer protections of the country where you live.</p>
  <h2>8. Changes</h2><p>We may update these terms; the version date will change.</p>`,

  refunds: () => html`<h1>Refund policy</h1>${notice}
  <p>This policy supplements, and does not reduce, your statutory consumer rights.</p>
  <h2>Eligibility and deadline</h2><p>You may return unused items in their original condition and packaging within <strong>30 days</strong> of delivery (the site owner may adjust this period before launch). Items that are damaged, faulty or not as described can be returned at any time within your statutory rights.</p>
  <h2>How to return</h2><ol><li>Contact ${mail()} with your order reference and the reason.</li><li>We will confirm the return method and address. Do not send items before we reply.</li><li>Keep proof of postage.</li></ol>
  <h2>Refund timing and method</h2><p>Once we receive and check the item we will refund the amount paid, normally within 14 days, using the payment method arranged for your order. Original shipping is refunded if the item was faulty or not as described.</p>
  <h2>Damaged goods</h2><p>If an item arrives damaged, email us within 7 days with photographs and your order reference. We will arrange a replacement or refund.</p>`,

  shipping: () => html`<h1>Shipping &amp; delivery, and how ordering works</h1>
  <ol><li>Add products to your cart and choose <strong>Checkout</strong>.</li><li>Fill in the order enquiry form. Nothing is charged.</li><li>Open the prefilled email to our support address (or copy the details). Opening your email app does not send it; you must press send.</li><li>Our team contacts you to confirm the items, final shipping cost, any taxes, and how to pay.</li><li>After staff independently confirm payment, your order moves to processing and is shipped.</li></ol>
  <h2>Shipping estimate</h2><p>The cart shows an estimated flat shipping fee per currency (USD ${(config.shipping.USD.flat / 100).toFixed(2)}, GBP ${(config.shipping.GBP.flat / 100).toFixed(2)}, CAD ${(config.shipping.CAD.flat / 100).toFixed(2)}), free above ${(config.shipping.USD.freeOver / 100).toFixed(0)} USD / ${(config.shipping.GBP.freeOver / 100).toFixed(0)} GBP / ${(config.shipping.CAD.freeOver / 100).toFixed(0)} CAD. Costs for remote locations or large items may differ; we tell you before you pay. We do not give delivery dates on the site; we confirm them when we contact you.</p>`,

  accessibility: () => html`<h1>Accessibility statement</h1><p>We aim to meet WCAG 2.2 level AA. Accessibility is built into the pages themselves (semantic HTML, keyboard operation, visible focus, text alternatives, labelled forms); we do not use an accessibility overlay or widget.</p>
  <p>See <code>docs/ACCESSIBILITY_REPORT.md</code> in the project for what has and has not been tested. Product images are illustrations with descriptive alternative text. If you meet a barrier, contact ${mail()} and we will help.</p>`,

  contact: () => html`<h1>Contact &amp; support</h1><ul><li>Email: ${mail()}</li>${config.phone ? html`<li>Phone: ${config.phone}</li>` : ''}${config.address ? html`<li>Address: ${config.address}</li>` : ''}</ul>
  <p>You can also use the <strong>Live chat</strong> button (human agents, when online) or the <strong>AI assistant</strong> button (an AI; optional, with consent). If no agent is online, chat lets you leave an enquiry.</p>
  <p>Check an enquiry: <a href="/order-status">order status</a>.</p>`,

  about: () => html`<h1>About ${biz()}</h1><p>${biz()} is an online sporting goods shop covering 30 sport categories. The catalogue in this version contains sample listings for demonstration; replace them with real supplier data before trading.</p>`,
};
