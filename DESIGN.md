# Access Kit design contract

Independent identity product. Neutral light canvas, charcoal typography, restrained indigo action. No game/alliance colors, imagery or terminology in navigation branding.

Tokens: background #f6f7fb, surface #ffffff, text #182230, muted #667085, border #e4e7ec, primary #4657cf, danger #b42318, positive #067647. Dark login variant: background #121722, surface #1c2433, text #f4f6fb, muted #a9b4c7. System typography 14/16 body, 24/32 headings. Spacing 8/12/16/24/32; radius 12. Buttons 44px minimum. No external fonts or animations.

Console: 224px persistent sidebar and bounded content; mobile navigation horizontal, stacked controls. Pages: overview, applications, members, seasons, services, administrators, branding, history. Searchable tables with detail drawer. Action confirmation in HTML dialog, no native browser confirm. Empty, loading, failure, saved and permission-denied states visible. Persistent labels and keyboard focus.

Login: single centered panel, service branding, Google button, application/status only. No management or SDK navigation. Console login is a separate intent and returns to console. Service branding includes title, safe HTTPS logo, accent, theme and short description, preview before save.

Permission: existing operators retain superadmin authority. Scoped member managers only manage their organization; developers only own services. User identities and membership restrictions preserved. Role revocation server enforced. Last operator deletion rejected atomically.

Verification: desktop1440/mobile390, real role grant/revoke, member approval/suspension, access diagnosis, login and reconnection. Design preview uses same tokens; no mock success labels.
