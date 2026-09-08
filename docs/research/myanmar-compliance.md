# Myanmar Compliance: Sanctions, Data Law, and the Auth Decision

**Status:** Desk research v1 — not legal advice
**Last updated:** 2026-08-27
**Related:** [TECH_STACK.md](../TECH_STACK.md), [DATA_MODEL.md](../DATA_MODEL.md), [CONTEXT.md](../../CONTEXT.md)

---

## 1. Bottom line

**No. Compliance does not force the auth decision.** Keeping self-rolled auth
or adopting a managed provider is still an engineering trade-off, not a legal
one. Every managed auth provider we checked (Clerk, WorkOS, Auth0/Okta,
Supabase, Firebase/Google Cloud, AWS Cognito) restricts by *sanctioned party*,
not by *country*, and none of them names Myanmar or Burma anywhere in its
published terms. The reason is upstream: **US, EU and UK sanctions on Myanmar
are targeted list-based regimes, not comprehensive embargoes.** Myanmar is not
Cuba, Iran, North Korea or Syria — and those four (plus occupied Ukrainian
regions) are exactly the list every US vendor actually writes into its
contract.

**The single biggest risk found is not sanctions and not auth. It is Myanmar's
own Cybersecurity Law (SAC Law No. 1/2025), in force since 30 July 2025.** Two
provisions bite directly on this app's data:

- **§ 33** — a digital platform service provider must **retain each user's
  personal information and usage records for 3 years**.
- **§ 34** — it must **hand that data over on written request** from any
  authority empowered under any law in force, with no judicial gate.

Combined with [ETL § 27-c](#23-electronic-transactions-law-2004-as-amended-2021)
and the suspension of the Privacy Law's search-and-seizure safeguards, the
practical position is that **Myanmar law creates a lawful-access pathway to
Customer names, phone numbers and delivery addresses that this app has no
technical or contractual defence against**, wherever the bytes physically sit.
That is a product and ethics question about how much end-customer PII to hold
and for how long — a much bigger question than which library signs the session
cookie.

**Good news on the highest-value question in §2:** we found **no data
localization requirement** in any Myanmar instrument we could obtain. Neon in
Singapore, Vercel `sin1` and Cloudflare R2 are not invalidated. See
[§2.5](#25-data-localization--the-decisive-question) for the caveat about
delegated regulations that have not been published.

One live, unrelated finding worth acting on: **Paddle explicitly refuses
Myanmar sellers by name.** Payments, not auth, is where the country actually
gets excluded.

---

## 2. Sanctions: the legal position

The distinction that governs everything here is **comprehensive embargo**
versus **targeted (list-based) sanctions**. A comprehensive embargo prohibits
essentially all transactions with a country's persons and territory — that is
the Cuba, Iran, North Korea and Syria model, and it is what makes vendors write
those four countries into their contracts by name. A targeted regime blocks
only the property of specifically designated persons and specifically listed
goods or sectors; ordinary commercial dealings with unlisted businesses remain
lawful. **Myanmar is in the second category in all three jurisdictions.**

### 2.1 United States (OFAC)

The controlling instrument is the **Burma Sanctions Regulations, 31 CFR Part
525**, which implement **E.O. 14014, "Blocking Property With Respect to the
Situation in Burma"** (11 February 2021). OFAC's own
[Burma-Related Sanctions programme page](https://ofac.treasury.gov/sanctions-programs-and-country-information/burma)
lists the complete legal framework: E.O. 14014, a determination under
§ 1(a)(i), IEEPA and the NEA as enabling statutes, 31 CFR 525, and Directive 1
(financial services to or for the benefit of Myanma Oil and Gas Enterprise).
There is no comprehensive-embargo executive order in that list.

The regulation's operative prohibition is narrow and explicitly person-scoped.
[31 CFR § 525.201(a)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-525)
reads:

> All property and interests in property that are in the United States, that
> come within the United States, or that are or come within the possession or
> control of any U.S. person **of the following persons** are blocked and may
> not be transferred, paid, exported, withdrawn, or otherwise dealt in:
> (1) Any person determined by the Secretary of the Treasury, in consultation
> with the Secretary of State: (i) To operate in the defense sector of the
> Burmese economy, the jet fuel sector of the Burmese economy, or any other
> sector of the Burmese economy as may be determined…

Note 1 to § 525.201 confirms the mechanism: designated persons are published in
the Federal Register and carried on the **SDN List** under the
`[BURMA-EO14014]` identifier. In the
[2021 publication of the regulations](https://ofac.treasury.gov/system/files/126/31cfr525.pdf)
the entire Subpart B — Prohibitions runs to five sections (§§ 525.201–525.205),
all of which concern *blocked property*: effect of violating transfers,
interest-bearing accounts, maintenance of blocked tangible property, and exempt
transactions. There is no section prohibiting trade with, or provision of
services to, Burma as a country.

**What this means for SuSeeOS:** providing a SaaS to a Myanmar-registered
business is not a prohibited transaction under 31 CFR 525 unless that business,
its owners, or a counterparty is on the SDN List (or is 50%-or-more owned by
blocked persons — see § 525.406). The compliance obligation is **screening**,
not abstention.

### 2.2 European Union

The instrument is **Council Regulation (EU) No 401/2013**, most recently
consolidated at
[02013R0401-20250429](https://eur-lex.europa.eu/eli/reg/2013/401/2025-04-29/eng).
Its prohibitions are sectoral and item-specific: dual-use goods and technology
intended for military use, the military end-user or the Border Guard Police;
equipment which might be used for internal repression as listed in Annex I;
arms; communications-monitoring equipment; and asset freezes plus travel bans
on listed natural and legal persons. The Council's own summary of the regime is
at
[EUR-Lex: Restrictive measures in respect of Myanmar/Burma](https://eur-lex.europa.eu/EN/legal-content/summary/restrictive-measures-in-respect-of-myanmar-burma.html).

The Council's
[April 2026 renewal press release](https://www.consilium.europa.eu/en/press/press-releases/2026/04/27/myanmar-eu-restrictive-measures-extended-until-april-2027/)
describes the measures as applying to a finite list of individuals and
entities, extended to 30 April 2027. Nothing in the regulation prohibits
supplying ordinary software services to an unlisted Myanmar business.

### 2.3 United Kingdom

The instrument is the
[Myanmar (Sanctions) Regulations 2021 (SI 2021/496)](https://www.legislation.gov.uk/uksi/2021/496/contents),
made under the Sanctions and Anti-Money Laundering Act 2018. Its structure is
the same shape as the EU's: Part 2 designation of persons, Part 3 finance
(asset freezes on designated persons), Part 4 director disqualification, Part 5
immigration, Part 6 trade (specified goods and technology), Part 7 information
and records.

HM Government's own
[Myanmar sanctions guidance](https://www.gov.uk/government/publications/myanmar-sanctions-guidance)
confines the trade prohibitions to military, security and paramilitary goods
and technology; dual-use items for military or security-force end use; internal
repression goods; and interception and monitoring equipment and services. There
is no blanket prohibition on commercial dealings with Myanmar persons.

### 2.4 The conclusion that matters

All three regimes are targeted. Therefore **bucket (a) — "legally prohibited by
sanctions" — is empty for every provider in this document**, on the assumption
that neither the Organization, its owners, nor its Customers appear on the SDN
List, the UK Sanctions List, or the EU consolidated list. Everything else in
§3 is bucket (b): a vendor choosing, commercially, to exclude more than the law
requires.

---

## 3. Providers: who will actually contract with a Myanmar business

### 3.1 How to read the table

| Bucket | Meaning |
|---|---|
| **Legally prohibited** | A sanctions instrument forbids the transaction. **Nothing lands here.** |
| **ToS-excluded** | The vendor names Myanmar/Burma, or its published eligibility list omits Myanmar in a way that is operative. |
| **Supported** | Vendor terms restrict by sanctioned *party* only; Myanmar is not named and no country gate applies. |
| **Unclear** | The vendor publishes no country list and no clause we could retrieve, or the governing document was unreachable. |
| **N/A — no vendor** | Self-hosted OSS. There is no counterparty, so there is nothing to be excluded from. |

### 3.2 The table

| Provider | Bucket | Evidence |
|---|---|---|
| **Vercel** (in production) | Supported | [Terms § 14.1](https://vercel.com/legal/terms): you warrant "you are not the target of sanctions administered or enforced by … OFAC, the U.S. Department of State, the United Nations Security Council, the European Union". Party-based; no country named. |
| **Neon** (in production) | Unclear | The [Product Specific Schedule (Neon)](https://neon.com/terms-of-service) (updated 5 Aug 2026) is now a Databricks document with no export/sanctions clause of its own; it subordinates itself to the Databricks MCSA, which we could not retrieve (see [§5](#5-what-we-could-not-determine)). |
| **Cloudflare** (in production, R2 + CDN/DNS) | Supported | [Self-Serve Subscription Agreement § 7.1](https://www.cloudflare.com/terms/): you may not use the Service if you "are subject to sanctions or otherwise designated on any list of prohibited or restricted parties". Lists SDN, FSE, BIS Entity List. No country named. |
| **Clerk** | Supported | [Terms](https://clerk.com/legal/terms): generic export-control and embargo-compliance covenant; no country named, no Myanmar. |
| **WorkOS** | Supported | [Terms of Service](https://workos.com/legal/terms-of-service) (updated 4 Aug 2026), read in full: contains **no** export-control, sanctions or restricted-country clause at all. |
| **Auth0 / Okta** | Supported | [Okta MSA § 12.8](https://www.okta.com/sites/default/files/2025-02/MSA_Q1FY26_Online_Terms.pdf): "Customer will not permit any User to access or use the Service … in a U.S. embargoed country or region (the list … is currently **Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk and Luhansk regions of Ukraine**)". Myanmar is conspicuously absent from an explicitly enumerated list — the strongest single piece of evidence in this document. |
| **Supabase (auth)** | Supported | [Terms § h, Export Regulation](https://supabase.com/terms): generic EAR compliance covenant; no country enumerated. |
| **Firebase Auth / Google Cloud** | Unclear (leaning supported) | The [Google Cloud Platform Terms](https://cloud.google.com/terms/) define "Export Control Laws" (EAR, OFAC, ITAR) but publish no country list. Google's nearest published enumeration — [Publisher Policies: Sanctions compliance](https://support.google.com/publisherpolicies/answer/11128499) — names Crimea, Cuba, DNR/LNR, Iran and North Korea, and does not name Myanmar; but that page governs publisher products, **not** Cloud. |
| **AWS Cognito** | Supported | [AWS Customer Agreement § 11.6](https://aws.amazon.com/agreement/): compliance with sanctions and export law generally; no country enumerated. Cognito is available in `ap-southeast-1` per the [AWS regional services list](https://api.regional-table.region-services.aws.a2z.com/index.json). |
| **better-auth** | N/A — no vendor | [MIT-licensed](https://github.com/better-auth/better-auth), self-hosted. There is no service agreement, no counterparty, and therefore no country eligibility question. Sanctions analysis does not apply. |
| **Lucia** | N/A — no vendor | [MIT-licensed](https://github.com/lucia-auth/lucia), self-hosted, and now primarily a set of guides rather than a runtime dependency. Same reasoning as better-auth — and the pattern the current implementation already follows ([TECH_STACK.md § 2](../TECH_STACK.md#2-why-this-stack)). |
| **Stack Auth** | Unclear | `stack-auth.com` now 308-redirects to `hexclave.com`, which returns no reachable terms-of-service page. We could not locate any published terms to check. |
| **Resend** | Supported | [Terms of Service](https://resend.com/legal/terms-of-service), read in full: no export-control, sanctions, embargo or restricted-country clause of any kind. |
| **Postmark** | Supported | [Terms § 18(a)](https://postmarkapp.com/terms-of-service): "a jurisdiction where the provision of the Service is prohibited by law (a 'Prohibited Jurisdiction'), including without limitation **Cuba, Iran, North Korea, Syria, and the Crimea region**." Myanmar absent from an enumerated list. |
| **SendGrid (Twilio)** | Supported | [Twilio Terms § 5.2](https://www.twilio.com/en-us/legal/tos): party-based warranty ("not on any government sanctions or restricted party lists"); no country enumerated. |
| **Amazon SES** | Supported | Same AWS Customer Agreement as Cognito. SES is available in `ap-southeast-1`. |
| **Mailgun (Sinch)** | Supported, but check the list | [Mailgun Terms](https://www.mailgun.com/legal/terms/) push compliance to the customer; Sinch's [General Terms](https://sinch.com/legal/terms-and-conditions/other-sinch-terms-conditions/general-terms-and-conditions/) define "Restricted Countries" as China (incl. Hong Kong and Macau), Belarus, Iran, DPRK, Russia and Syria. Myanmar is not on it — but note this vendor *does* maintain a country list broader than US law requires, so it is the one most likely to add countries. |
| **Stripe** | ToS-excluded (product) | [stripe.com/global](https://stripe.com/global) enumerates supported business countries. Singapore, Thailand and Malaysia are supported; **Myanmar is not listed**. A Myanmar-registered business cannot be the Stripe account holder. |
| **Paddle** | **ToS-excluded, by name** | [Which countries are supported by Paddle?](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle) lists unsupported seller countries and names **"Burma (Myanmar)"** explicitly, alongside Afghanistan, Belarus, Cuba, Iran, North Korea, Russia, Syria and others. This is a vendor exclusion well beyond what sanctions law requires — a textbook bucket (b). |
| **Lemon Squeezy** | ToS-excluded (effectively) | [Supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries): Myanmar appears on **neither** list — not on the bank-payout country list, and not on the unsupported-buyer list. Payouts require a Stripe bank payout or PayPal, and Myanmar is on neither [Stripe's](https://stripe.com/global) nor [PayPal's](https://www.paypal.com/us/webapps/mpp/country-worldwide) country list, so merchant onboarding has no working payout path. |

### 3.3 Reading the pattern

The pattern is unusually consistent and worth stating plainly, because it is
the actual answer to the research question: **every vendor that bothers to
enumerate countries enumerates the same five or six**, and Myanmar is on none
of them. Vendors that enumerate: Okta, Postmark, Sinch, Paddle, Google
(publisher), Lemon Squeezy. Of those, only **Paddle** names Myanmar. Vendors
that do not enumerate — Vercel, Cloudflare, Clerk, WorkOS, Supabase, AWS,
Twilio, Resend, Google Cloud — all restrict by sanctioned party instead, which
Myanmar-registered businesses can satisfy on a screening basis.

The exclusions that do exist cluster entirely in **payments**, which is
predictable: payment providers carry KYC/AML and correspondent-banking exposure
that a database or an auth API does not. That is the future problem worth
planning around, and it does not touch auth.

---

## 4. Myanmar domestic law on data

### 4.1 Cybersecurity Law (SAC Law No. 1/2025) — the one that matters

Enacted by the State Administration Council on **1 January 2025** and brought
into force on **30 July 2025** by SAC Notification No. 113/2025. It runs to 16
chapters and 88 sections. We worked from the
[English translation published by Lincoln Legal Services (Myanmar) Limited](https://www.lincolnmyanmar.com/wp-content/uploads/2025/01/Cybersecurity-Law.pdf),
which is marked "convenience translation — accuracy not guaranteed"; see
[§5](#5-what-we-could-not-determine) on why that caveat matters.

**Does it reach this app?** Probably not directly, but the definition is broad.
§ 4(k) defines *digital platform services* as "a type of business that provides
services that enable users to display, transmit, distribute or use information
online using cyber resources", and § 4(l) defines a *digital platform service
provider* as one providing such services **"that can be used within the
state"** — which on its face captures a foreign-hosted SaaS with Myanmar users.
Jurisdiction under § 3(a)(2) extends to "offences committed within the national
cyberspace or in any other cyberspace connected to the national cyberspace",
and § 3(b) reaches Myanmar citizens residing abroad.

**Registration.** § 24 requires registration with the Department **only for a
digital platform service provider with 100,000 or more users within the
state**, which must also be a company registered under the Myanmar Companies
Law. SuSeeOS is orders of magnitude below that threshold, so the registration
duty does not currently attach. The penalty for crossing it unregistered is
severe — § 64 sets a fine of **not less than MMK 100,000,000** plus
confiscation of evidence as state property — so the threshold is worth tracking
as a growth trigger, not ignoring.

**Data storage.** § 30(b) requires a digital platform service provider to
"maintain[] the data storage device **as prescribed** depending on the level
[of classification] of the data of the user accessing the service." § 17(a)–(b)
imposes a parallel "as prescribed" duty on critical information
infrastructure operators. **Neither section says "inside Myanmar."** Both
delegate the substance to regulations issued under the law. See § 4.5.

**Retention.** § 33 is the sharpest edge for this app:

> A digital platform service provider shall retain the following data regarding
> a user of the service **for 3 years**: (a) Personal information of the user
> accessing the service; (b) usage records of the user accessing the service;
> (c) data specified by the Department from time to time.

Note this is a *floor*, not a ceiling — it forbids the deletion strategy that
would otherwise be the cleanest mitigation for § 34.

**Government access.** § 34: "If an individual or organisation authorised under
any law in force requests in writing any or all of the data in section 33, the
digital platform service provider shall provide it as prescribed." There is no
court order, no notice to the data subject, and no stated grounds requirement.
§ 35 adds a general cooperation duty. § 38 lets a working committee seize and
analyse cyber resources from persons suspected of involvement in a cyber
incident.

**Platform control.** § 43 lets the Ministry, with Union Government consent,
temporarily suspend digital platform services or electronic information,
temporarily control materials related to them, or close them and declare them
unfit for public use. § 44 requires Ministry permission to establish or provide
VPN services within national cyberspace.

**Enforcement.** § 52 gives the Department a ladder of administrative orders
for breaches of §§ 30–35: warning, fine, temporary suspension of the
registration certificate, and revocation plus blacklisting.

### 4.2 Electronic Transactions Law (2004), as amended 2021

The Law Amending the Electronic Transactions Law, dated **15 February 2021**,
inserted a new **Chapter 10, "Protection of Personal Information"**. We worked
from the
[bilingual Burmese/English text hosted on the Open Development Myanmar Datahub](https://data.opendevelopmentmyanmar.net/en/laws_record/law-amending-the-electronic-transactions-law-15-feb-2021/),
translated by Free Expression Myanmar.

New § 2(l) defines "personal information"; § 2(m) defines the "person
responsible for the management of personal information". § 27-a imposes four
duties on that person:

> (1) systematically keep, protect and manage the personal information based on
> its types, security levels in accordance with the law; (2) not allow,
> disclose, inform, distribute, dispatch, modify, destroy, copy and submit as
> evidence of the personal information of an individual **without the consent**
> or the permission in provisions included in an existing law…; (3) not utilize
> personal information for managing issues that are not in compliance with the
> objectives; (4) systematically destroy the personal information that is
> collected to be used for a period of time after a certain period.

That is a recognisable, if skeletal, set of data-protection principles:
security, consent, purpose limitation, deletion. But § 27-c then carves the
whole thing open. "Personal Information Management shall not include" —
i.e. the § 27-a duties do not apply to — prevention, search, enquiry,
investigation and evidence-gathering by government agencies in relation to
cybersecurity and cybercrime, criminal investigation and prosecution generally,
and, most broadly, activity "carried out in accordance with the authority on
each relevant issue of **stability of state sovereignty, public order, national
security**".

### 4.3 Is there a general data protection act?

**No.** Myanmar has no omnibus data protection statute. What exists is the
patchwork above: ETL Chapter 10, Cybersecurity Law §§ 30–35, sectoral rules,
and the Law Protecting the Privacy and Security of Citizens (2017), which is a
general privacy-and-liberty statute rather than a data protection law.

That last one has been narrowed. The Ministry of Information's own announcement
records that
[**SAC Law No. 4/2021, dated 13 February 2021**](https://www.moi.gov.mm/moi:eng/index.php/announcements/2734)
suspended **sections 5, 7 and 8** of the Privacy Law under Article 420 of the
Constitution, "only during the period when the State Administration Council is
assigned to the State Power according to Article 419". Section 5 is the
provision that required witnesses for a search of a residence; section 7
required a court order for detention beyond 24 hours. The safeguards that
constrained state access to persons and premises are, by the government's own
publication, currently switched off.

**Practical consequence for SuSeeOS:** there is no Myanmar law imposing a
GDPR-style obligation (lawful basis, DSARs, breach notification, DPO, transfer
restrictions) that this app is failing to meet. The obligations that do attach
are the retention floor and the disclosure duty, both of which point the same
direction: **stored PII in this app is reachable by the state on request.**

### 4.4 Registration and licensing for operating an online service

Two separate regimes, and the second one is the one that actually applies today.

1. **Cybersecurity Law § 24** — digital platform registration, but only at
   100,000+ users in-state (see § 4.1).

2. **Ministry of Commerce Notification No. 51/2023, the Online Sales Business
   Registration Order**, issued 21 July 2023 under section 4(c) of the
   Essential Supplies and Services Law
   ([English text, commerce.gov.mm](https://commerce.gov.mm/sites/default/files/documents/2024/05/51-2023%28Online%20Sale%29%20English%20version.pdf)).
   This one has a low threshold and directly describes what SuSeeOS's
   Organizations do. Clause 3: "Anyone who desires to operate online sales
   business shall complete the application form specified by the Department and
   apply for a Registration Certificate to the Department through online
   system." Clause 4 requires the applicant to be a company formed under the
   Myanmar Companies Law (or equivalent) with an official website in its own
   name and a presentable business premises. Certificates run two years
   (clause 13) and must be renewed 60 days in advance (clause 16).

   Clause 18 sets the Registration Certificate Holder's duties, including
   18(j): "shall keep the consumer's personal information or information that
   is undesirable to disclose by the consumer **except the case of disclosing
   it according to the directive of any department and government organization
   or any law**." The same shape as everywhere else: a confidentiality duty
   with an open-ended state carve-out.

   Registration is enforced in practice — the state newspaper reports
   [21,000 e-commerce firms approved over 24 months](https://www.gnlm.com.mm/moc-approves-record-21000-e-commerce-firms-in-24-months/)
   and the Ministry of Information records
   [7,169 registrations approved between 2 October 2023 and 8 August 2024](https://www.moi.gov.mm/moi:eng/news/15124).

   **This is an obligation of the Organization (the operator's client), not of
   SuSeeOS as a platform** — but it is worth knowing, because it is the
   compliance step a Myanmar Organization onboarding onto this product is most
   likely to ask about, and because clause 4(b)'s "official website in its own
   name" requirement interacts with how tenants are exposed.

### 4.5 Data localization — the decisive question

**We found no data localization requirement.** Nothing in the Cybersecurity Law
2025, the Electronic Transactions Law as amended, the Privacy Law, or MoC
Notification 51/2023 requires that Myanmar citizens' or customers' personal
data be stored on servers physically inside Myanmar.

The nearest approach is Cybersecurity Law § 30(b) — "maintaining the data
storage device **as prescribed** depending on the level [of classification] of
the data of the user accessing the service" — and its CII twin at § 17(a)–(b).
Both are enabling hooks: they oblige a provider to store data in whatever
manner subordinate regulations prescribe, and those regulations set the
substance. **A localization mandate could be introduced by regulation under
§ 30(b) without any new primary legislation.** We could not locate any such
regulation, and we could not confirm that none exists (see
[§5](#5-what-we-could-not-determine)).

So: **Neon in Singapore, Vercel `sin1`, and Cloudflare R2 are not invalidated
by anything we could find.** The § 30(b) hook is a watch item, not a present
obligation — and it applies to *digital platform service providers*, a
category SuSeeOS arguably falls into by definition but is far below the
registration threshold for.

---

## 5. What we could not determine

Stated plainly, because a confident wrong answer here is worse than an
acknowledged gap.

- **No official English text of the Cybersecurity Law.** The only English
  version we could obtain is a law firm's convenience translation, expressly
  marked "accuracy not guaranteed". Section numbers and thresholds quoted in
  § 4.1 should be verified against the Burmese original before anything is
  built on them. We did not find the law on an official Myanmar government
  domain in either language.

- **The regulations under the Cybersecurity Law.** §§ 17 and 30(b) both defer
  to what is "as prescribed". We could not locate any published implementing
  rules, notifications or directives. **We therefore cannot state that no
  localization or in-country storage requirement exists — only that none
  appears in the primary statute, and that we found none published.** This is
  the single most important gap in this document, because it is exactly where a
  localization mandate would live.

- **SAC Notification No. 113/2025** (commencement of the Cybersecurity Law) —
  we confirmed its existence, date and effect only through secondary reporting,
  not from the notification itself or an official gazette.

- **The Electronic Transactions Law consolidated text.** We read the 2021
  amending law in a bilingual civil-society publication, not an official
  consolidation. We have not verified the current consolidated ETL, nor whether
  further amendments post-date February 2021.

- **The Databricks Master Cloud Services Agreement**, which now governs Neon.
  databricks.com returned HTTP 403 to every retrieval attempt. Neon's own
  Product Specific Schedule contains no export or sanctions clause, so **the
  export/sanctions terms actually binding on our production database are
  unread.** Given Neon is already in production, this is worth ten minutes with
  a browser.

- **Stack Auth's terms.** `stack-auth.com` redirects to `hexclave.com`, which
  serves no terms page we could find. We cannot classify it.

- **Google Cloud's country position.** Google publishes no restricted-country
  list for Cloud specifically. The enumeration we cite governs publisher
  products. We are inferring, not quoting, when we say Firebase Auth is
  available to a Myanmar business. Note also that Google Cloud's
  [self-serve billing currency list](https://cloud.google.com/billing/docs/resources/currency)
  omits Myanmar — but that page says absence means charges fall back to USD,
  **not** that the country is unsupported, so it is not evidence of exclusion.
  We initially misread this and are recording the correction deliberately.

- **Enforcement reality.** We deliberately make no claim about how any of these
  Myanmar obligations are enforced in practice, against whom, or with what
  consistency, because we found no primary source that would support such a
  claim. The registration statistics in § 4.4 come from state media and
  establish only that the e-commerce registration system is operating.

- **Sanctions screening of actual counterparties.** This document establishes
  that Myanmar as a country is not embargoed. It does **not** establish that
  any particular Organization, owner or Customer is clear of the SDN List, the
  UK Sanctions List or the EU consolidated list. That is a per-counterparty
  check nobody has run.

---

## 6. Practical implications for the stack

### 6.1 Regions

Everything the current architecture assumes is available, and Singapore is the
right answer throughout.

| Layer | Singapore available? | Source |
|---|---|---|
| **Neon Postgres** | Yes — AWS Asia Pacific (Singapore), `aws-ap-southeast-1`. Sydney `aws-ap-southeast-2` is the only other APAC option. | [Neon regions](https://neon.com/docs/introduction/regions) |
| **Vercel Functions** | Yes — `sin1` (`ap-southeast-1`). Vercel operates 20 compute regions; APAC comprises `sin1`, `hkg1`, `hnd1`, `kix1`, `icn1`, `bom1`, `syd1`. Note the default for new projects is `iad1` (Washington DC), so this must be set explicitly. | [Vercel regions](https://vercel.com/docs/regions) |
| **Cloudflare R2** | Partially — `apac` is available as a **location hint**, explicitly "best effort and not a guarantee". R2's **jurisdictional restrictions**, which are the binding form, support only `eu`, `fedramp` and `us`. **There is no APAC jurisdiction.** | [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/) |
| **AWS** (if Cognito/SES) | Yes — both Cognito and SES run in `ap-southeast-1`. | [AWS regional services list](https://api.regional-table.region-services.aws.a2z.com/index.json) |

The R2 line is the one worth internalising. A location *hint* is a performance
optimisation; a *jurisdiction* is a contractual guarantee about where bytes
live — and Cloudflare offers the guarantee only for the EU, the US and
FedRAMP. **If a hard "not in the US" data-residency requirement ever
materialised, R2 could not satisfy it for Asia**, and product images plus order
screenshots are exactly the objects that carry incidental PII. That is a
latent constraint in the current architecture, independent of Myanmar law.

### 6.2 Does Singapore versus US change the analysis?

**For sanctions: no.** The regimes are person-based, not territorial. Routing a
Myanmar Organization's traffic through `sin1` rather than `iad1` does not
change whether a transaction with a designated person is blocked, and does not
change any vendor's terms — Vercel, Cloudflare, Clerk and the rest apply the
same clause regardless of region.

**For Myanmar law: no, and this is the important half.** Cybersecurity Law § 34
and ETL § 27-c operate on the *provider* and on persons within Myanmar
jurisdiction, not on the server. Moving data to Singapore does not put it
beyond a written request served on a Myanmar-established Organization, whose
staff hold the credentials. Data residency is not a defence against lawful
access directed at the account holder.

**For latency and for exposure to US legal process: yes, marginally**, and both
in the same direction. Singapore is the closest region to Myanmar and Thailand,
which is why
[TECH_STACK.md § 2](../TECH_STACK.md#2-why-this-stack) already pins it. Keeping
primary storage out of US regions also reduces the surface for US compulsory
process, though every vendor here is a US company and therefore reachable
regardless of where it stores bytes — which is a reason to treat region choice
as a latency decision that happens to be mildly helpful, not as a compliance
control.

### 6.3 What this means for the auth decision

The auth question returns to where it started: **an engineering trade-off,
decided on migration cost, feature need and operational burden**, exactly as
[TECH_STACK.md § 3](../TECH_STACK.md#3-explicitly-rejected--deferred) framed
it. Compliance neither forces nor forbids a managed provider. Two secondary
observations, offered as inputs rather than conclusions:

- **Self-hosted (better-auth, Lucia-pattern) has a genuine, if small,
  compliance advantage**: no vendor relationship means no vendor can
  unilaterally add Myanmar to a restricted-country list. Mailgun/Sinch already
  maintains a country list broader than US law requires, and Paddle names
  Myanmar outright, so this is a real failure mode with observed precedent —
  just not one currently affecting any auth provider.

- **The email provider is the more urgent gap.** Invites and password reset
  need one, none is in the stack today, and Resend, Postmark, SendGrid and SES
  are all clear. Postmark and Okta both publish enumerated lists that omit
  Myanmar, which makes them the best-evidenced choices in this document.

The genuinely actionable finding is not about auth at all. It is
[§4.1](#41-cybersecurity-law-sac-law-no-12025-—-the-one-that-matters): this app
stores real end-Customer names, phone numbers and delivery addresses, Myanmar
law requires them retained for three years and disclosed on written request,
and no infrastructure choice changes that. Decisions about **how much
end-Customer PII to collect, and whether the address is retained after an Order
Item reaches Completed**, are worth more here than the choice of session
library.

---

## 7. Disclaimer

This is desk research, not legal advice. It was assembled from published
primary sources — regulations, statutes, official government announcements and
providers' own contractual terms — by reading those documents directly. It has
not been reviewed by a lawyer in any jurisdiction, and it does not create a
solicitor–client or attorney–client relationship.

Points that specifically warrant confirmation from **Myanmar-qualified
counsel** before being relied on:

1. **Whether SuSeeOS is a "digital platform service provider"** under
   Cybersecurity Law § 4(l), and whether §§ 30–35 (storage, retention,
   disclosure) apply below the § 24 registration threshold of 100,000 in-state
   users, or only to registered providers.
2. **Whether any regulation, rule or directive issued under the Cybersecurity
   Law prescribes data storage location** under § 30(b) or § 17. This is the
   question that would change the architecture, and it is the one we could not
   close.
3. **Whether an offshore-hosted SaaS with Myanmar users is within the practical
   reach of § 34**, and what an operator's obligations are when a written
   request arrives.
4. **Whether the operator's Organizations must hold an Online Sales Business
   Registration** under MoC Notification 51/2023, and whether the platform
   bears any duty to verify it.
5. **The current consolidated status of the Electronic Transactions Law** and
   whether Chapter 10 has been amended or superseded by the 2025 Cybersecurity
   Law.
6. **Whether the 3-year retention floor in § 33 conflicts with any deletion
   right**, and what a compliant Customer-data deletion policy actually looks
   like.

Separately, and not requiring Myanmar counsel: **read the Databricks MCSA** now
governing Neon, and run a one-off sanctions-list screening of the operator and
its Organizations. Neither is hard; both are currently unreviewed.
