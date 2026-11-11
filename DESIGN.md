# Access Kit UI contract

## Layout and hierarchy
Developer installation: 1120px shell, 220px sticky step rail, flexible content. Below 760px: horizontal step navigation, single column with 16px gutters. Decision sequence: service registration, SDK installation, validation, upgrades.

## Tokens
Background #0b1020, panel #111a2b, line #29364b, text #f1f5f9, muted #a6b3c7, action #8395ff. System typography; headings 36/30/22px, body 15px; spacing 8/12/16/24/28/40px; card radius 16px. Restrained radial light, no animation.
Membership approval retains the existing reviewed dark/gold form palette (#15140f, #211f18, #e4c578) and native controls. No alliance name in shared identity.

## Components and states
Native labelled inputs/selects; action button at least 44px; current service selector; copyable command panel; details for server adapter code. Explicit loading, saved, rejected and unavailable states. Buttons disable during writes and recover after errors.

## Access and privacy
Developer page and service-management API require operator or explicitly granted developer access. Service lists and writes are owner scoped. No tokens or secret key inputs in the installation page. SDK configuration is non-secret. Ordinary login remains Google -> game identity application -> approval -> return to service.

## Accessibility and validation
Visible focus, polite status messages, labels in Korean, semantic sections. Verify desktop 1440px and mobile 390px with no horizontal overflow. Copy failures offer manual selection. Verification is an observation, never an automatic deployment-success claim.

## Accepted scope
Workers static installer plus Fetch API server adapter. Deployment instructions and private release distribution; no public marketing page or public package registry.
