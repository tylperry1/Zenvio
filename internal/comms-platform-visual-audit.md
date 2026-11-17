# Zenvio — Visual design audit

**Date:** 2026-11-16 (America/New_York)  
**Direction:** Clear & Connected (cobalt / midnight / light surfaces)  
**Method:** Production Playwright screenshots + CSS/theme review. Authenticated dense screens not live-rendered here.

## Summary

Public marketing, auth, help, and pricing present as a coherent premium SaaS surface. Production smoke found **no horizontal overflow** at 375–1920. Marketplace storefront remains **visibility-gated** (404). Dark-mode hardcodes on marketplace shop chips/panels and booking profile cards were tokenized in this pass.

## Captured evidence

Store: `/cursor/stores/bc-5ed720cf-26c3-428e-85f9-793637f9f6e8/media/launch-audit/`  
Artifacts: `/opt/cursor/artifacts/`

| File | Route | Viewport | Theme |
| --- | --- | --- | --- |
| `public-_-375.png` | `/` | 375 | default |
| `public-_-1440.png` | `/` | 1440 | default |
| `public-_pricing-375.png` | `/pricing` | 375 | default |
| `public-_pricing-1440.png` | `/pricing` | 1440 | default |
| `pricing-dark-1440.png` | `/pricing` | 1440 | forced `data-theme=dark` |
| `public-_sign-up-375.png` | `/sign-up` | 375 | default |
| `public-_sign-up-1440.png` | `/sign-up` | 1440 | default |
| `public-_help-375.png` | `/help` | 375 | default |
| `public-_help-1440.png` | `/help` | 1440 | default |

## Checklist by surface

| Surface | Hierarchy | Contrast | Spacing | Cards | Responsive | Theme | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Marketing home | PASS | PASS | PASS | OK | PASS | spot | Brand-forward hero retained |
| Pricing | PASS | PASS | PASS | OK | PASS | spot dark shot | Live catalog still v3 Individual/Teams |
| Sign-up / Sign-in | PASS | PASS | PASS | OK | PASS | default | Public signup open |
| Help / Contact / Support | PASS | PASS | PASS | OK | PASS | default | |
| Demo | PASS load | — | — | — | PASS | — | Interactive; deep visual not scored |
| Booking pages | PARTIAL | PARTIAL | — | fixed tokens | NOT TESTED live host | token fix | Needs real host slug for full shot |
| Marketplace | N/A | — | — | tokenized CSS | gated 404 | CSS fix ready | Do not show in nav when invisible |
| App shell / Growth / BP | CI | prior #64 | prior | prior | CI | prior dark fixes | Live auth NOT TESTED |
| Client portal | prior + sign CTA | prior hero CTA | — | — | NOT TESTED | prior tokens | |
| Admin | CI | — | — | — | CI | — | Live NOT TESTED |

## Findings

| ID | Severity | Finding | Action |
| --- | --- | --- | --- |
| V-01 | P1 | Marketplace `shop.css` light-locked whites | Tokenized key surfaces |
| V-02 | P1 | Booking `profile.css` `background: white` | `var(--surface-card)` |
| V-03 | P2 | Icon reuse (bell/bag collisions) in shell | Documented; not changed |
| V-04 | Info | Forced dark pricing shot is attribute-only; full theme sync needs real preference path | Acceptable for evidence |

## Responsive matrix (public)

All listed public routes: **PASS** at 375 / 768 / 1024 / 1440 / 1920 (overflow 0).  
Not covered live: 390×844 and 1280×800 specifically — nearest widths used (375 / 1024 / 1440).

## Verdict

**Visual quality: PASS for public launch surfaces**, with remaining authenticated/portal visual QA deferred to CI fixtures or designated test accounts. Do not flip marketplace visibility until a dark/light storefront pass is re-shot on production.
