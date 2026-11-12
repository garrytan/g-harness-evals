# Snipster booking flow: adversarial walkthrough

## Persona

**Rita Moretti**, 66, retired bus driver. Books her cut and colour every six weeks by ringing the salon. Uses her phone for calls and photos of the grandchildren; her son set up her email. Reading glasses on a cord. Her one job: book her usual cut and colour with Jo, on a weekday morning. She gives up the moment it asks for anything she does not understand. "If I can't do it in the time it takes the kettle to boil, I'm phoning."

## Rita's review of Snipster

Overall: No. She would phone the salon, the same as always.

THE GOOD (grudging admission):
- The photos of the salon are nice. "That's Jo's chair, I know that chair."
- Once she found a slot, picking it was one click.

THE BAD (legitimate UX issues):
- She had to make an account before she could even see what the salon offers or what it costs.
- The service list is in code. She could not find "cut and colour".
- Prices only show up after picking a stylist, so she could not compare.
- Times in 24-hour format and tiny slots.

THE UGLY (showstoppers):
- "Error 402" wiped her card details. She closed the tab.
- A GBP 10 charge with no explanation. "Ten pounds for what?"
- No email after booking. She has no proof the booking exists.

SPECIFIC COMPLAINTS:
1. Landing page: "Where's the button? I can see pictures going round and round." - the Book now button is grey and below the fold; she expected a big button at the top.
2. Create account: "Why does a haircut need my birthday and a password like a bank?" - password rules appear only after she failed; she expected to be told up front, or not to need an account at all.
3. Choose a service: "What on earth is BLD-FULL?" - internal names; she expected plain words like "Full head colour".
4. Choose stylist and time: "Fourteen hundred? I'm not in the army." - 24-hour times, slots too small for her glasses.
5. Deposit: "Ten pounds for what? Do I get it back?" - no explanation of the deposit.
6. Card failure: "It's rubbed out everything I typed." - "Error 402" and the form cleared; she expected a plain message and her details kept.
7. Confirmation: "So is it booked or not? Nobody's emailed me." - no email, no calendar entry; she expected a confirmation like the salon's text message.
8. Carousel: "Stop moving!" - the photos keep changing while she reads.
9. Cancelling: "I have to write an email to cancel? I'll just not turn up." - no cancel button.

VERDICT: "I spent twenty minutes to do what Jo does in two on the phone."

## Pragmatism filter

| # | Complaint | Rating | Why |
|---|---|---|---|
| 1 | Book now button hidden | RED: REAL UX BUG | Any busy customer misses a grey button below the fold. |
| 2 | Account before seeing services or prices | RED: REAL UX BUG | A 35-year-old would bounce here too; it blocks the core job. |
| 3 | Internal service names | RED: REAL UX BUG | Jargon no customer knows. |
| 4 | 24-hour times, 28 px slots | YELLOW: VALID BUT LOW PRIORITY | Real for older users and an accessibility point, but most customers cope. |
| 5 | Unexplained deposit | RED: REAL UX BUG | Unexplained charges kill conversion for everyone. |
| 6 | Error 402 clears the form | RED: REAL UX BUG | Error recovery is broken for any user. |
| 7 | No confirmation email | RED: REAL UX BUG | Every customer needs proof of the booking. |
| 8 | Carousel keeps moving | WHITE: PERSONA NOISE | Mildly annoying, but the fix for her is the button, not the carousel. |
| 9 | No cancel button | GREEN: FEATURE REQUEST | Self-service cancelling would also cut no-shows. |

Rita needed 17 clicks for one haircut; anything over 5 is a RED finding on its own, covered by tickets 1 and 2.

## Tickets

### 1. Let customers see services and prices before creating an account
- Persona quote: "Why does a haircut need my birthday and a password like a bank?"
- Real issue: the account wall comes before any value; the core job is blocked.
- Suggested fix: move account creation to after the slot is chosen; ask only for name, email and phone.
- Label: ux-review

### 2. Make Book now the first thing on the landing page
- Persona quote: "Where's the button? I can see pictures going round and round."
- Real issue: the primary action is low contrast and below the fold.
- Suggested fix: high-contrast Book now button at the top of the page.
- Label: ux-review

### 3. Use plain service names and show prices in the list
- Persona quote: "What on earth is BLD-FULL?"
- Real issue: internal codes as customer-facing names; prices hidden until a stylist is chosen.
- Suggested fix: customer-facing names ("Full head colour") with a from-price on each service.
- Label: ux-review

### 4. Explain the deposit on the payment screen
- Persona quote: "Ten pounds for what? Do I get it back?"
- Real issue: an unexplained charge.
- Suggested fix: one line saying what the deposit is for and when it is refunded.
- Label: ux-review

### 5. Keep card details and show a plain message when a card fails
- Persona quote: "It's rubbed out everything I typed."
- Real issue: "Error 402" plus a cleared form.
- Suggested fix: "Your card was declined. Please check the number or try another card." Keep all fields except the CVC.
- Label: ux-review

### 6. Send a confirmation email with an add-to-calendar link
- Persona quote: "So is it booked or not? Nobody's emailed me."
- Real issue: no proof of booking.
- Suggested fix: send an email on confirmation with the time, stylist, address and a calendar file.
- Label: ux-review

### 7. Add a cancel button to the confirmation email and Manage bookings
- Persona quote: "I have to write an email to cancel? I'll just not turn up."
- Real issue: cancelling needs an email, which encourages no-shows.
- Suggested fix: one-click cancel link in the confirmation email.
- Label: ux-review

### 8. Catch-all: low-priority notes (YELLOW)
- 24-hour times and 28 px slots: offer 12-hour times and larger tap targets.
- Label: ux-review

Not ticketed (WHITE): the carousel complaint.
