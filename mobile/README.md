# Ng'umbi Riders — Android app

An Expo / React Native app for the owner, accountants and riders. It shows the
live site (`https://www.ngumbi.co.tz`) inside a native shell, so **every feature
and every fix reaches the app with each Vercel deploy — no new APK needed.**

What the shell adds over the browser:

- opens at `/app`, which sends a signed-in owner, accountant or rider straight
  to their own area (everyone else to the sign-in page), and stays signed in;
- the Android back button steps back through pages;
- a Swahili "Hakuna mtandao" screen with **Jaribu tena** when there is no network;
- phone, WhatsApp, USSD, maps and other websites open in the right Android app;
- receipts, PDFs and exports download to the phone's Downloads folder
  (with the sign-in session, so private files work);
- the camera can be used for document photos;
- the web "Add to home screen" banner is hidden inside the app
  (the app tags its user agent `NgumbiApp/1.0`).

## Build the APK

```bash
cd mobile
npm install
./scripts/build-apk.sh        # → dist/ngumbi-riders-<version>.apk
```

Needs JDK 17 (a prebuilt Temurin in `~/.jdks/`, or `brew install openjdk@17`)
and the Android SDK in `~/Library/Android/sdk`.

## The signing key — back it up

The first build creates `mobile/credentials/` (release key + passwords). It is
git-ignored on purpose. **Copy that folder somewhere safe.** Android installs an
update over the existing app only when it is signed with the same key; lose it
and every phone has to uninstall and reinstall the app.

## When a new APK is needed

Only for changes to the shell itself (this folder: icon, name, permissions,
`App.tsx`). Bump `version` and `android.versionCode` in `app.json`, then rebuild.
Website changes never need a new APK.

## Installing on a phone

Send the APK (WhatsApp, Google Drive, USB). On the phone, open it and allow
"Install unknown apps" for the app it was opened from when Android asks.
