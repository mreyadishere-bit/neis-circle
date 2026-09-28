# NEIS Circle Android

Native Android wrapper for https://neiscircle.site with FCM push notifications.

## Required private configuration

Do not commit these files/secrets:

1. Firebase Android app package: `site.neiscircle.app`
2. Firebase `google-services.json` -> GitHub secret `FIREBASE_GOOGLE_SERVICES_JSON_B64`
3. Firebase service-account JSON -> Supabase Edge Function secret `FIREBASE_SERVICE_ACCOUNT_JSON`
4. Stable Android signing keystore -> GitHub secret `ANDROID_KEYSTORE_B64`
5. Signing passwords -> `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
6. Add `neiscircle://auth` to Supabase Auth > URL Configuration > Redirect URLs so Google OAuth can return from the system browser to the app.

The app deliberately opens Google OAuth outside the WebView because Google blocks embedded WebView OAuth.

## Build

The GitHub Action `.github/workflows/android-apk.yml` builds the signed release APK after the required secrets are configured.

Package: `site.neiscircle.app`
Minimum Android: 7.0 (API 24)
Target SDK: 36
