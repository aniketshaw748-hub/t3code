# Free remote access and phone notifications

You can use Kavyaan on your phone from anywhere, and get notified when an agent finishes, without
T3 Connect or any paid service. Two free pieces do the work:

- **Tailscale** joins your computer and phone into a private network, so the phone reaches your
  computer wherever it is.
- **Firebase Cloud Messaging** (FCM) carries notifications. Your own computer sends them to your
  own Firebase project, so nothing passes through a Kavyaan server.

The computer that runs your agents (the host) must be on for either to work.

## 1. Connect the phone over Tailscale

1. Install Tailscale on the computer and on the phone (tailscale.com/download) and sign in to the
   same account on both.
2. In Kavyaan on the computer, open **Settings → Access**. Under **Phone over Tailscale**, press
   **Check Tailscale**. It tells you what is missing: install, start, or sign in.
3. When Tailscale is connected, choose how phones reach Kavyaan:
   - **Serve over HTTPS** gives a `https://<computer>.<tailnet>.ts.net` address. It needs HTTPS
     certificates turned on for your tailnet (Tailscale admin console → DNS → HTTPS
     Certificates). Kavyaan restarts to apply it.
   - **Use Tailscale IP** turns on network access and uses the `100.x.y.z` address. Kavyaan
     restarts to apply it.
4. Press **Show pairing QR** and scan it with the phone camera. The Kavyaan app opens on the
   pairing screen with the address filled in; check it is your computer and tap **Connect**.
   You can also scan it from **Settings → Environments → Add** in the app.

Each pairing QR works once. Make a new one for another phone. Remove a phone in **Settings →
Access** to revoke it; that also stops its notifications.

## 2. Turn on phone notifications

You need a Firebase project once. It is free.

1. Go to console.firebase.google.com and create a project.
2. Add an Android app with the package name `dev.kavyaan.app`. Download its
   `google-services.json`. This file goes into the Android app build (see the build guide for
   `T3CODE_ANDROID_GOOGLE_SERVICES_FILE`); it is not a secret.
3. In **Project settings → Service accounts**, press **Generate new private key**. This downloads
   a JSON file with `"type": "service_account"`. It is a secret: keep it only on the host
   computer, never share or commit it.
4. In Kavyaan on the computer, open **Settings → General → Notifications → Phone notifications
   (direct)**. Choose the folder that holds the key (or paste the path to the file) and save.
   Kavyaan reads the key from where you keep it; it stores only the path.
5. On the phone, open **Settings → Notifications** and allow notifications. Each paired computer
   is listed with its status. Tap a computer to send a test notification, or press **Send test
   notification** on the computer.

You get an alert when an agent finishes, fails, needs approval, or asks for input, and an ongoing
card while agents work (turn it off with **Ongoing Agent Activity**). On Android 11 and newer,
running threads can float as bubbles: open **Thread bubbles** in the app's notification settings
to allow them, then tap a thread's bubble to watch or answer it without leaving what you are
doing.

## Things to know

- Notifications come from the host itself. If the host is asleep or off, nothing is sent.
- Signing in to T3 Connect on the phone switches its notifications to T3 Connect; the direct
  path stops until you sign out.
- If the computer says **Delivery failing**, the reason is shown next to it. A common one is a key
  from a different Firebase project than the app's `google-services.json`.
- Several computers can notify the same phone. They share one ongoing card, so the newest
  update wins.
