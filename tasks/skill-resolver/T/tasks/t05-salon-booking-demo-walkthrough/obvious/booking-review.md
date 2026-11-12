# Snipster booking flow review

## Who I tested as

A 66-year-old regular who has always booked by phone, uses her phone mainly for calls, reads with glasses, and has little patience for forms. She wants one thing: her usual cut and colour with her usual stylist on a weekday morning.

## Walkthrough

1. **Landing page.** She looks for a way to book and only sees a rotating carousel. The grey "Book now" button is below the fold and easy to miss.
2. **Create account.** She is asked for a password and date of birth before seeing a single service or price. The password rules only appear after she fails. Marketing consent is pre-ticked, which is also a GDPR problem.
3. **Choose a service.** "BLD-FULL" and "Balayage Lite (T2)" mean nothing to her. No prices yet.
4. **Choose stylist and time.** 24-hour times and 28 px slots are hard to read and hit. There is no "first available".
5. **Deposit.** A GBP 10 charge with no explanation. When her card fails she sees "Error 402" and the whole form is cleared. This is where she gives up.
6. **Confirmation.** Only a booking reference. No email, no calendar entry, and cancelling means writing an email.

Total: 6 screens and about 17 clicks for one haircut.

## Issues by severity

### Critical
- Card failure shows "Error 402" and clears the form. Fix: plain-language decline message, keep the entered details.
- No confirmation email. Fix: send a confirmation with time, stylist, address and an add-to-calendar link.

### High
- Account required before browsing. Fix: let people pick a service and slot first, ask for details at the end.
- Unexplained deposit. Fix: one line on what it is for and whether it is refundable.
- Book now button hidden. Fix: high-contrast button at the top of the landing page.

### Medium
- Internal service names and hidden prices. Fix: customer-facing names with prices in the list.
- 24-hour times and small slots. Fix: 12-hour times, larger slots, a "first available" option.
- Pre-ticked marketing consent. Fix: untick by default.

### Low
- Auto-playing carousel. Fix: stop autoplay or slow it down.
- Cancelling by email only. Fix: add a cancel link to the confirmation.

## What to fix before Thursday

1. The card error and cleared form.
2. The confirmation email.
3. Moving the account step to the end.
4. Making the Book now button obvious.
