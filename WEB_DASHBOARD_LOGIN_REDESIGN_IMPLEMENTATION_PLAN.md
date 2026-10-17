# Web Dashboard Login Redesign Implementation Plan

## Goal

Redesign `/login` to follow the supplied Norz-Agapay reference: branded navy header, a white mobile-number/password sign-in card on the left, and clear account-registration actions over the MDRRMO building photo on the right.

## Implementation

1. Reuse the existing clean MDRRMO building photo at `web-dashboard/public/login-background.jfif` as the login-page backdrop.
2. Restructure `LoginPage` into a responsive two-column layout: retain the current login card and place barangay registration and resident account creation in a right-side callout.
3. Keep all existing authentication behavior, including mobile-number/password sign-in, SMS password recovery, first-admin setup, login errors, and developer quick login.
4. Style the header, backdrop overlay, card, callout, buttons, and focus states to match the reference while keeping text readable over the photo.
5. Add responsive layouts so the card and registration callout stack and remain usable on mobile screens.
6. Build the web dashboard to catch TypeScript and bundling errors.

## Scope

Only the web dashboard login page and its styles are changed, plus this plan document. Registration routes and authentication APIs keep their existing behavior.
