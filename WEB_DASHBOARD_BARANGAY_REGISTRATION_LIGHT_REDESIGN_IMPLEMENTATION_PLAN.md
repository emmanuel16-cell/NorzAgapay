# Barangay Registration Light Redesign Implementation Plan

## Goal

Restyle `/barangay/register` to match the Resident registration page's light, centered-card presentation while leaving the Barangay registration flow intact.

## Implementation

1. Remove the public navigation header and crest/graphic mark from the Barangay registration page.
2. Reuse the existing login background photo and light card styles for the page.
3. Align the title, explanatory copy, fields, status messages, buttons, and back-to-sign-in link with the Resident registration design.
4. Add a matching two-step indicator for entering account details and verifying the SMS code.
5. Keep the Barangay-specific fields, eligibility loading, SMS OTP requests, account verification, and MDRRMO review notice unchanged.
6. Ensure the form remains scrollable and readable on narrow screens, then build the web dashboard.

## Scope

Only the Barangay registration page presentation and its styles are changed, plus this plan document. The Resident registration page and authentication APIs are unchanged.
