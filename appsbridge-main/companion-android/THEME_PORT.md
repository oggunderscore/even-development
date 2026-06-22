# Even Toolkit Native Android Port

The Android companion is a native app, so it cannot directly import `even-toolkit` React/CSS components. The native theme resources port the Even Toolkit phone UI tokens and component geometry to Android XML/Kotlin.

Credit/source:

- Even Toolkit by fabioglimb
- Package: `even-toolkit`
- Version checked: `1.7.2`
- npm author/maintainer: `fabioglimb <fabio.glimb@gmail.com>`
- Repository: `https://github.com/fabioglimb/even-toolkit`
- License: MIT
- Token reference: `even-toolkit/web/theme/tokens-light.css`
- Typography reference: `even-toolkit/web/theme/typography.css`
- Component reference: `even-toolkit/web/components/*`

Native resources:

- `app/src/main/res/values/colors.xml`
- `app/src/main/res/values-night/colors.xml`
- `app/src/main/res/values/dimens.xml`
- `app/src/main/res/drawable/card_bg.xml`
- `app/src/main/res/drawable/panel_bg.xml`
- `app/src/main/res/drawable/even_input_bg.xml`
- `app/src/main/res/drawable/even_tile_bg.xml`
- `app/src/main/res/drawable/segmented_button_bg.xml`
- `app/src/main/res/drawable/even_button_*_bg.xml`
- `app/src/main/res/drawable/even_badge_*_bg.xml`
- `app/src/main/res/drawable/even_checkbox_*_bg.xml`
- `app/src/main/res/drawable/even_radio_*_bg.xml`
- `app/src/main/res/drawable/even_toggle_track_*_bg.xml`
- `app/src/main/assets/third_party_licenses.txt`

Font note:

- Even Toolkit CSS references `FK Grotesk Neue`.
- The `even-toolkit@1.7.2` npm package does not ship FK Grotesk font files.
- Android uses the toolkit fallback stack equivalent via native `sans`/system fonts unless a licensed FK Grotesk font file is added separately.

When porting more UI, first check `even-toolkit/web/components/*` and mirror the token values, radius, spacing, and text sizes in Android resources.
