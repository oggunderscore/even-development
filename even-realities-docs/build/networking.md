# Networking

*How fetch() works inside the WebView - the app.json network whitelist, CORS, and debugging APIs that work locally but fail on device.*

Source: https://hub.evenrealities.com/docs/build/networking

> **Last updated:** 2026-06-11

Even Hub plugins talk to the network the way any web app does - `fetch()`, `XMLHttpRequest`, WebSockets - from inside the WebView the Even Realities App hosts on the phone. Two independent gates sit in front of every outbound request, and most "works locally, fails on device" bugs trace back to confusing one for the other.

## The two gates

Every outgoing request has to clear **both** checks:

1. **Even-side permission check.** The destination domain must be in your `app.json` `network` permission `whitelist`. The Even Realities App enforces it before the request ever leaves the WebView. Anything not in the whitelist is blocked - no traffic generated at all.

2. **Browser CORS check.** The WebView's browser engine (Chromium on Android, WKWebView on iOS) enforces standard CORS. The remote server has to return the right `Access-Control-Allow-Origin` (and friends), or the response is dropped before your `fetch()` resolves.

> **WARNING**
>
> **The whitelist is not a CORS bypass**
>
> Adding a domain to `app.json` does **not** override CORS. It only tells the Even Realities App that your plugin is allowed to reach that domain at all. If the server's CORS headers are wrong, the browser still drops the response - same as in any other web page.

## Declaring the whitelist

In your `app.json`, request the `network` permission and list every domain your plugin will hit:

```json
"permissions": [
  {
    "name": "network",
    "desc": "Fetches weather data and stores user preferences in the cloud.",
    "whitelist": [
      "https://api.weather.com",
      "https://prefs.example.com"
    ]
  }
]
```

Notes:

- One whitelist entry per origin. Use the full origin (`https://api.example.com`) - bare hostnames and wildcards aren't supported.

- HTTPS in production. Plain `http://` is only useful for local dev against a LAN dev server.

- Full schema in [Packaging & Deployment → Permissions Format](https://hub.evenrealities.com/docs/ship/packaging#permissions-format).

## Required server-side CORS headers

For a third-party API to be reachable from the WebView, the server must return at minimum:

```http
Access-Control-Allow-Origin: *
# or specifically the WebView origin if you can identify it
```

For requests with custom headers, JSON bodies, or non-`GET`/`POST` methods, also handle the preflight:

```http
# Response to the OPTIONS preflight
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

If the API is third-party and you can't touch its CORS, proxy through a server you control that sets the right headers - then put **that** server's domain in the `app.json` whitelist.

## Debugging checklist

When a request fails on device, work this list in order:

1. **Domain is in `app.json` `network.whitelist`?** Repack and reupload if you changed it.

2. **Response has `Access-Control-Allow-Origin`?** If it's missing or doesn't match your origin, fix it on the server.

3. **Preflight (`OPTIONS`) returns 2xx with the right `Allow-Methods` / `Allow-Headers`?** Only matters for JSON bodies and custom headers.

4. **Same request from `curl` succeed?** If `curl` works and the WebView doesn't, it's almost always CORS.

## Related

- [Packaging & Deployment → Permissions Format](https://hub.evenrealities.com/docs/ship/packaging#permissions-format)

- [App Submission & QA Guidelines → First-run experience](https://hub.evenrealities.com/docs/ship/app-submission#first-run-experience-no-black-screens)

- [Architecture](https://hub.evenrealities.com/docs/get-started/architecture)

