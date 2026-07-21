# Flat GitHub deployment

## Upload

1. Extract `iiti-spark-flat-upload.zip` on your computer.
2. Open the extracted folder.
3. In the GitHub repository select `Add file → Upload files`.
4. Select all files inside the extracted folder and upload them.
5. Commit directly to `main`.

The repository root must contain `index.html`; do not upload the enclosing folder itself.

## Publish

1. Open `Settings → Pages`.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select branch `main`.
4. Select folder `/(root)`.
5. Click **Save**.

The project URL is normally:

`https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`

## Connect the database

Follow `DATABASE_SETUP.md`, then paste the Apps Script `/exec` URL and Google Web Client ID into `config.js`.
