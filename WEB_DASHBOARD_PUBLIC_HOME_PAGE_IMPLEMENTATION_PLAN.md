# Web Dashboard Public Home Page Implementation Plan

## Goal

Add a public home page to `web-dashboard` with a branded header based on the supplied screenshot. The header provides **Log in** and **Report Incident** actions that open their corresponding pages. Make the public home and report entry points strictly usable on mobile screens.

The screenshot is a visual reference for the header arrangement, colors, branding, and action buttons. It does not provide product or implementation instructions.

## Current-state findings

- `web-dashboard/src/App.tsx` currently uses `/` as the protected dashboard Command Center route.
- `/login` displays `LoginPage`, which currently combines MDRRMO/barangay login with the public guest report form and hotline directory.
- `/reports` is a protected operations page for viewing and handling reports. It is distinct from a resident-facing report submission page.
- The matching circular brand asset already exists at `web-dashboard/public/NA-icon.png`.
- The dashboard already has a shared `index.css` design system and mobile rules, but the new public homepage and its header need dedicated responsive styling.

## Page and route behavior

1. Make `/` the public home page.
2. Keep `/login` as the login page for MDRRMO and barangay dashboard accounts.
3. Add `/report` as the public resident incident submission page. Reuse the existing guest-report form and hotline data flow instead of maintaining a second submission implementation.
4. Keep `/reports` protected as the internal dashboard report queue; do not use it as the public **Report Incident** destination.
5. Move the protected Command Center entry point from `/` to `/command-center`. Preserve the existing paths for other protected pages, such as `/reports`, `/locations`, and `/requests`.
6. Update post-login redirects, dashboard navigation links, role-based redirects, and internal links that currently use `/` to use `/command-center` where they mean the dashboard. Keep public navigation pointed at `/` and `/report`.
7. Confirm direct navigation to protected routes still enforces authentication and role access after the root-route change.

## Homepage design

### Header

- Recreate the supplied header composition with a dark navy background, circular Norz-Agapay emblem, gold wordmark, and right-aligned actions.
- Reuse `NA-icon.png` for the emblem. Provide meaningful alternative text and size the image without distortion.
- **Log in** opens `/login`.
- **Report Incident** opens `/report` and uses a clear alert icon and red action treatment.
- Keep the header in normal document flow or sticky only if it does not obscure content or mobile keyboard focus.

### Main content

- Add a concise public hero that identifies Norz-Agapay as the local emergency reporting and response service.
- Provide a prominent **Report Incident** action that matches the header destination.
- Include short, plain-language guidance on submitting a report and what information to prepare. Keep claims consistent with the existing MDRRMO-first intake flow.
- Use the established dark navy, gold, cyan, and emergency red palette. Keep the page focused on the two requested paths rather than duplicating dashboard operations UI.

## Public report page

- Extract or refactor the public guest reporting form from `LoginPage` into a reusable public-report component/page.
- Retain its current submission behavior, mandatory mobile number, location capture, optional evidence attachment, submission feedback, and public hotline directory.
- Keep `/login` focused on account login, with a link to `/report` so residents arriving there can still find the public reporting path.
- Ensure public reporting works without a dashboard account and does not expose internal report management data.

## Strict responsive requirements

- Design from narrow screens upward; support 320 CSS-pixel width through desktop layouts without page-level horizontal scrolling.
- At wide widths, keep the emblem and wordmark at the left and both actions on the right, matching the reference.
- At phone widths, allow the header to wrap cleanly: keep branding legible and give the two actions full, usable touch targets. On very narrow screens, stack actions if side-by-side buttons would clip or become hard to tap.
- Use fluid widths, `min-width: 0`, wrapping text, and bounded image sizes. Avoid fixed page widths and viewport assumptions that fail in landscape or with browser zoom.
- Ensure all interactive targets are at least 44 CSS pixels high, have visible keyboard focus, and remain reachable when the on-screen keyboard is open.
- Respect safe-area insets, text zoom, and reduced-motion preferences. Maintain readable text contrast on the dark header and action buttons.
- Apply responsive layout to the public report form and hotline list as well as the landing header, so the destination remains usable after tapping **Report Incident**.

## Implementation phases

### 1. Route and component structure

- Add the public home page and public report page components.
- Refactor `App.tsx` so `/` and `/report` are public while protected Command Center and management routes continue to require the existing auth and role checks.
- Move the protected Command Center route to `/command-center` and update internal dashboard links and redirects consistently.
- Split public report UI from login UI while preserving the existing data submission behavior.

### 2. Header and home content

- Build the reusable public header with the supplied brand arrangement and existing logo asset.
- Add the homepage hero, concise reporting guidance, and correctly routed actions.
- Keep button labels and page content clear to residents using touch screens and assistive technology.

### 3. Mobile layout and accessibility

- Add isolated responsive styles for the public home, header, and public report page.
- Check narrow layouts for wrapping, readable controls, image scaling, and lack of horizontal overflow.
- Add semantic landmarks, heading order, accessible button names, focus states, and appropriate alt text.

### 4. Regression and acceptance review

- Review route access for signed-out visitors, authenticated MDRRMO users, and authenticated barangay users.
- Confirm dashboard login redirects to `/command-center`, and internal Command Center links no longer send users to the public home.
- Confirm the public header actions open `/login` and `/report`, while `/reports` remains a protected internal report queue.
- Review the home, login, and report pages at 320, 360, 390, 768, and desktop widths, including phone landscape and browser text zoom.
- Confirm no page-level horizontal scroll, clipped actions, overlapping branding, inaccessible controls, or unexpected route redirects.

## Acceptance criteria

- A signed-out visitor opening `/` sees a public Norz-Agapay home page.
- The header visually follows the supplied reference, using the existing Norz-Agapay emblem and wordmark.
- **Log in** opens `/login`; **Report Incident** opens `/report`.
- `/report` supports public incident submission and retains the existing guest mobile-number requirement and hotline directory.
- `/reports` continues to be an authenticated dashboard page and is not confused with public reporting.
- Successful dashboard login opens the protected Command Center at `/command-center`.
- Existing MDRRMO and barangay role boundaries remain in force on every protected dashboard page.
- The home, login, and report paths work at phone-sized widths without horizontal page scrolling or clipped content.
- Header actions remain readable, keyboard accessible, and easy to tap across portrait, landscape, and narrow-screen layouts.

## Out of scope

- Changes to backend report lifecycle, MDRRMO/barangay assignment rules, or database schema.
- Redesign of protected dashboard operations screens beyond updating their route links and redirects.
- New authentication methods or a change to the existing guest-report validation rules.
