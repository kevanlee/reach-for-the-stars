# Reach for the Stars — Chrome New Tab extension

This Manifest V3 extension replaces Chrome's New Tab page with a visual Buffer analytics dashboard.

## Connect Buffer

The extension uses a personal Buffer API key because Buffer OAuth App Clients cannot request the `insightsRead` permission required for analytics.

1. Open [Buffer API settings](https://publish.buffer.com/settings/api).
2. Create a personal API key with read access, including **Insights read**.
3. Open a new tab and paste the key into the extension.

The key is validated before it is saved. It is stored in `chrome.storage.local`, restricted to trusted extension contexts, and sent only to `https://api.buffer.com`. It is never included in source code or logs.

If the Buffer account belongs to multiple organizations, use the organization selector beside the timeframe. The extension remembers that selection for future new tabs.

Only Buffer organization owners can create personal API keys. Buffer keys expire according to the duration selected when they are created; use **Replace key** in the extension when needed.

## Build and load locally

```bash
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist` directory. If it is already loaded, click its **Reload** button after each build.

The checked-in public manifest key keeps the development extension ID stable:

```text
iojfnlgfcmaplobkccfnkgkbmodbldol
```
