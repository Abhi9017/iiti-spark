# Connect IITI Spark to Google Sheets

GitHub Pages hosts only the website. Google Apps Script is the backend that writes users, likes, matches, chats, reports, and sessions into Google Sheets.

## 1. Create a Google Cloud OAuth client

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen.
4. Create **Credentials → OAuth client ID → Web application**.
5. Add this authorized JavaScript origin:

   `https://YOUR_GITHUB_USERNAME.github.io`

   Do not include the repository path.
6. Copy the client ID ending in `.apps.googleusercontent.com`.
7. Do not create or place a client secret in the website.

## 2. Create the Apps Script backend

1. Open Google Apps Script and create a new standalone project.
2. Replace the default `Code.gs` content with the content from this package's `Code.gs`.
3. Add another script file named `Config.gs` and paste the supplied `Config.gs` content.
4. Open **Project Settings** and enable **Show `appsscript.json` manifest file in editor**.
5. Replace the manifest content with the supplied `appsscript.json`.
6. Save the project.

## 3. Create the Sheets database

1. In the Apps Script editor, select the function `setupProject`.
2. Click **Run**.
3. Approve the Google Sheets, Drive, and external-request permissions.
4. Open the execution log. It prints links to:
   - the master Google Sheet;
   - the Google Drive data folder.

Do not publish or publicly share the master sheet.

## 4. Configure the backend

In Apps Script, run this once after replacing the placeholders:

```javascript
configureApp(
  "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "iiti.ac.in",
  ["https://YOUR_GITHUB_USERNAME.github.io"]
);
```

For repository Pages such as:

`https://Abhi9017.github.io/iiti-spark/`

use this allowed origin:

`https://Abhi9017.github.io`

## 5. Deploy Apps Script

1. Select **Deploy → New deployment**.
2. Choose **Web app**.
3. Set **Execute as** to **Me**.
4. Choose an access option that permits the public GitHub frontend to open the endpoint, commonly **Anyone**.
5. Click **Deploy**.
6. Copy the deployment URL ending in `/exec`.

Test it in the browser:

`YOUR_EXEC_URL?action=health`

It should return a JSON response with `"ok": true`.

## 6. Connect the website

Open `config.js` in GitHub and replace the two placeholders:

```javascript
window.IITI_SPARK_CONFIG = {
  API_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  ALLOWED_DOMAIN: "iiti.ac.in",
  APP_NAME: "IITI Spark",
  TERMS_VERSION: "2026-07-21",
  DEMO_MODE: false,
  CHAT_POLL_MS: 3000
};
```

Commit the change. Refresh the GitHub Pages site.

## 7. Update the backend later

After changing `Code.gs` or `Config.gs`:

1. Open **Deploy → Manage deployments**.
2. Edit the existing web-app deployment.
3. Select **New version**.
4. Deploy.

Keep the existing `/exec` URL whenever you update the same deployment.

## Data organization

The backend automatically creates the master spreadsheet and these core sheets:

- `USERS`
- `MATCHES`
- `SESSIONS`
- `LIKES_INDEX`
- `BLOCKS`
- `REPORTS`
- `SHARDS`
- `AUDIT`

Swipe and chat records use rolling shard sheets. When configured limits are reached, the backend creates another shard or workbook automatically.

## Important limitations

- This is a pilot architecture, not a production-scale chat system.
- Chats are not end-to-end encrypted.
- Google Sheets should not be treated as a high-security messaging database.
- Do not store Google passwords; the supplied system does not request them.
- Keep dating access 18+ unless a legally reviewed, separately moderated minor-safety design is implemented.
