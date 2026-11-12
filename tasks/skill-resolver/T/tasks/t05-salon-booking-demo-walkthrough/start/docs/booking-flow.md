# Snipster web booking flow (staging build 0.9.3)

Snipster lets salon customers book appointments online. Most of our customers are 45 and over and book by phone today. This is the flow a new customer goes through, screen by screen.

## Screen 1: Landing page
- Auto-playing photo carousel, five slides, eight seconds each.
- The "Book now" button is grey text on a light grey pill, below the fold on a laptop.
- Footer link: "Manage bookings (beta)".

## Screen 2: Create account
- Required before anything else is shown. Fields: email, password, confirm password, date of birth, marketing consent (pre-ticked).
- Password rules: 12 or more characters, one symbol, one number. The rules appear only after a failed attempt.

## Screen 3: Choose a service
- 24 services in one list, using the salon's internal names, for example "BLD-FULL", "Balayage Lite (T2)", "Gents Std".
- Prices are hidden until a stylist is picked.

## Screen 4: Choose stylist and time
- Week view calendar, 24-hour times, slots are 28 px tall.
- No "first available" option; the customer must pick a stylist first, then hunt for a free slot.

## Screen 5: Deposit
- A GBP 10 deposit is required. There is no text explaining why or whether it is refundable.
- If the card fails, the page shows "Error 402" and clears the form.

## Screen 6: Confirmation
- Shows "Booking ref SNP-88231". No confirmation email, no add-to-calendar.
- To cancel, the customer has to email the salon.

Booking one haircut takes 6 screens and about 17 clicks for a new customer.
