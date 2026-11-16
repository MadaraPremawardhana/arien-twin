// ARIEN web app settings. Edit and redeploy; nothing here is secret (the app id is public in every request).
window.ARIEN_CONFIG = {
  // Accounts and saved sites: the ARIEN Base44 app's API (the same accounts and SolarSite records as arien.base44.app).
  appId: '6a4fb7864ffb55c91635b7d7',
  apiBase: 'https://arien.base44.app/api',
  authBase: 'https://arien.base44.app',   // "Continue with Google" goes through here
  // Base44 only returns a Google sign-in to its own address, so it comes back to this page of the Base44 app,
  // which passes the session on to this site (see README, "Google sign-in").
  ssoRelay: 'https://arien.base44.app/sso-return',
  // Where enquiries from the contact form, the waitlist and academic applications are emailed.
  // This address is readable by anyone who views the site's source.
  contactEmail: 'madarapremawardana@gmail.com',
  // The digital twin this site embeds. Its origin must be listed in the twin's src/account.js (PARENTS) and vice versa.
  twinUrl: 'https://madarapremawardhana.github.io/arien-twin/'
};
