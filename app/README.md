# Plank Plan — the app builds

The store builds of Plank Plan. There is no second copy of the app in here:
`../index.html` is still the whole thing, and this directory is the native
shell it runs inside.

```
../index.html          the app — untouched by anything in here
src/native.js          the native shell: ads, consent, share sheet, haptics
scripts/build-www.mjs  ../index.html -> www/, with the WebView changes
scripts/vendor-fonts.mjs   pulls the two typefaces in so the app works offline
scripts/check-www.mjs  what to run before you build a release
resources/             icon and splash sources, and the vendored fonts
android/  ios/         the native projects. Committed — they are hand-edited
www/                   generated. Never edit; it is overwritten every build
```

## Why a wrapper and not a rewrite

The engine is 70 tests deep and the drawing is already touch-first. Rewriting
it in Swift and Kotlin would mean maintaining the layout maths three times and
would gain nothing a user could see. Capacitor puts the same page in a
WebView on both platforms, so a fix to the room geometry ships everywhere at
once — including the web, which stays the primary way in.

## Working on it

```bash
npm install
node scripts/vendor-fonts.mjs   # once; the result is committed
npm run www                     # build www/ from ../index.html
npm run check                   # verify it before a release
npx cap sync                    # push www/ and plugins into the native projects

npm run android                 # build + open Android Studio
npm run ios                     # build + open Xcode (macOS only)
```

`npx cap run android` puts it on a connected device.

## What build-www.mjs does, and why

`../index.html` is never edited for the app's benefit. The build makes four
additive changes, and **throws if any of their anchors have moved** — a silent
no-op here ships a broken app, so it fails loudly instead.

1. **`viewport-fit=cover`** on the viewport meta, or iOS letterboxes the notch.
2. **Strips the Google Fonts link** and inlines the vendored faces. A remote
   font in an app is a blank first paint on a bad connection, a third-party
   request to declare on both stores' privacy forms, and a dependency on
   someone else's uptime.
3. **A native stylesheet** for the safe areas and the ad banner. `--ad-inset`
   is set at runtime from the banner's measured height, because an adaptive
   banner is not one fixed size.
4. **`native.js`**, which stands down immediately when it is not in an app, so
   the same page still opens straight off a phone.

If you change the header markup or the viewport meta in `../index.html`, this
script is what will tell you.

## Ads

Configured in two places, and they are different things:

| What | Where | Looks like |
| --- | --- | --- |
| **Application** ID | `android/…/AndroidManifest.xml`, `ios/App/App/Info.plist` | `ca-app-pub-…~…` (tilde) |
| **Ad unit** ID | `src/native.js` | `ca-app-pub-…/…` (slash) |

Both currently hold Google's public test IDs. They serve real-looking ads that
earn nothing and, more to the point, **cannot get your AdMob account suspended
when you tap your own ad while testing** — live units will do exactly that.

`npm run check` refuses to let the two get out of step: live units with
`testing: true` earns nothing, and test units with `testing: false` ships test
ads to real users.

The app-level ID is not optional. Without it the app crashes on launch, which
is a confusing way to find out.

## Things that will bite

- **`targetSdkVersion` moves every August.** `android/variables.gradle` is set
  to 35. Check the current floor before each release; Play rejects new apps
  below it.
- **`PrivacyInfo.xcprivacy` must be added to the Xcode target**, not just left
  on disk. Drag it into the project and tick "App" under Target Membership, or
  the upload is rejected.
- **`pod install`** has not been run — `npx cap add ios` could not do it on
  Windows. Run it in `ios/App` on the Mac before the first build.
- **The bundle ID is permanent.** `com.lukejamieson.plankplan` is a
  placeholder; change it in `capacitor.config.json`, `android/app/build.gradle`
  and Xcode *before* the first upload. After that it cannot be changed without
  publishing a different app.
- **Keep the signing keys.** Losing the Android upload key or the Apple
  distribution certificate means you cannot update your own app.

Publishing, store listings, consent and what the ads are actually likely to
earn are covered separately in the publishing guide.
