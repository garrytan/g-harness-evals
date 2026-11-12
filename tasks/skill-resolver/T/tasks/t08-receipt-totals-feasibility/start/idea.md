# Expense importer idea

Staff photograph receipts; our OCR vendor gives us plain text dumps (samples in samples/). The importer would read each dump and pre-fill the expense amount.

Open question: is plain pattern matching good enough to find the total, or do we need to pay for the vendor's structured receipt API (GBP 0.04 per receipt)?
