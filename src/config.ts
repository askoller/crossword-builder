// Google Cloud values for Drive backup and the Picker (SPEC §5.3). These are public by
// design: an OAuth client ID for a browser app has no secret, and the API key is
// restricted to the Picker API and this site. Never put a client secret or a token here.

/** OAuth 2.0 client ID (Web application) for Google Identity Services. */
export const GOOGLE_CLIENT_ID = '1035953971362-a90b0sjppfsfrbq7thk0geps2e7jcn2g.apps.googleusercontent.com';

/** Browser API key, restricted to the Google Picker API and this site. */
export const GOOGLE_API_KEY = 'AIzaSyCLQXEjQUPwdcCTZZ_3J2kyUvqaUuEVx5k';

/** Cloud project number; the Picker's app ID, so picked files are shared with this app. */
export const GOOGLE_APP_ID = '1035953971362';

/** The app sees only files it created or that Andrew picks. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DRIVE_FOLDER = 'Crossword Builder';
