---
name: download-rogers-bill
description: Navigate to MyRogers and download bill PDFs
category: tax/bills/telecom
preconditions: Must be logged into rogers.com (use bridge mode)
parameters:
  - billing_period: billing period label to download (e.g. "January 24, 2026")
  - filename: output filename for the download (e.g. "rogers-2026-01.pdf")
output: Full path to the downloaded PDF file (printed by wait-download)
---

# Download Rogers Bill

Navigates to MyRogers self-serve billing page, opens the Save PDF modal,
checks the requested billing period, downloads the PDF, and returns the saved path.

Use the `.pw` skill for simple single-period downloads. Use the `.js` skill for
multi-period downloads or when you need `download.saveAs(path)` to save outside
the default Downloads folder.

Note: The latest billing period is pre-checked by default.
