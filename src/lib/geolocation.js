/* Getting a position out of the browser, with failures that explain themselves. */

const DENIED_MESSAGE = 'Location is blocked for this site. Allow it from the padlock or ⓘ icon in the address bar, then try again — or just type a postal code or city, which works the same way.';

export async function currentPosition(options = {}) {
  if (!navigator.geolocation) {
    throw new Error('This browser has no location support. Type a postal code or city instead.');
  }
  if (!window.isSecureContext) {
    throw new Error('Browsers only share location over HTTPS. Open this page over https (or on localhost), or type a postal code instead.');
  }

  /* A denied permission is sticky — the browser will not prompt again, it just
     fails. Checking first means saying so immediately instead of after a wait. */
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    if (status?.state === 'denied') throw new Error(DENIED_MESSAGE);
  } catch (error) {
    if (error.message === DENIED_MESSAGE) throw error;
    /* permissions API unavailable — fall through and just ask */
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(new Error(message(error))),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000, ...options },
    );
  });
}

function message(error) {
  if (error.code === 1) return DENIED_MESSAGE;
  if (error.code === 2) return 'Your device could not work out where it is. This is common indoors and on desktops without GPS. Type a postal code or city instead.';
  return 'The location request timed out after 12 seconds. Type a postal code or city instead.';
}
