/* ISO 3166-1 alpha-2 codes. Names come from the browser via Intl.DisplayNames, so
 * they arrive already localised and this file stays a list of codes.
 *
 * The geocoder needs this because a bare postal code is ambiguous worldwide:
 * "2000" is a valid postcode in Australia, Belgium, Denmark and a dozen other
 * places, and free-text search will happily pick the wrong one. */

const CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AW', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BM', 'BN', 'BO', 'BR',
  'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM',
  'CN', 'CO', 'CR', 'CU', 'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FO', 'FR', 'GA', 'GB',
  'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GT',
  'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN',
  'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM',
  'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
  'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK', 'ML', 'MM',
  'MN', 'MO', 'MQ', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC',
  'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU',
  'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM', 'SN', 'SO',
  'SR', 'SS', 'ST', 'SV', 'SY', 'SZ', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TN',
  'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VC', 'VE',
  'VG', 'VI', 'VN', 'VU', 'WS', 'XK', 'YE', 'ZA', 'ZM', 'ZW',
];

/** Countries as {code, name}, localised and sorted for the current locale. */
export function countryOptions() {
  let names;
  try {
    names = new Intl.DisplayNames(navigator.language, { type: 'region' });
  } catch {
    names = null;
  }
  return CODES
    .map((code) => ({ code, name: names?.of(code) || code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The user's own country, guessed from their locale. Empty if it can't be read. */
export function defaultCountry() {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return region && CODES.includes(region) ? region : '';
  } catch {
    const parts = String(navigator.language || '').split('-');
    const region = parts[1]?.toUpperCase();
    return region && CODES.includes(region) ? region : '';
  }
}

/** Postal codes vary wildly, but they all contain a digit and no spaces-plus-words. */
export function looksLikePostalCode(query) {
  const trimmed = query.trim();
  return /\d/.test(trimmed) && /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(trimmed);
}
